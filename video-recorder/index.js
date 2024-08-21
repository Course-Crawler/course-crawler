import {getStream, launch} from "puppeteer-stream";
import * as fs from "node:fs";
import * as path from "path";
import axios from "axios";
import * as redis from "redis";

const videoId = parseInt(process.env.VIDEO_TO_RECORD_ID, 10);
const chunkSize = parseInt(process.env.CHUNK_SIZE, 10);

const serverUrl = process.env.VIDEO_SERVER_ENDPOINT || "http://localhost:3000";
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const videoDirPath = process.env.VIDEO_DIR_PATH || "/temp/videos/";
const defaultVideoExtension = process.env.DEFAULT_VIDEO_EXTENSION || "webm";
const configPath = "./config.json";

const email = process.env.EMAIL;
const password = process.env.PASSWORD;

const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const browser = await launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: ["--start-fullscreen", "--no-sandbox", "--disable-gpu", "--disable-setuid-sandbox", "--disable-features=dbus"]
});

const redisClient = redis.createClient({
    url: redisUrl,
});

async function publishVideoRecordedEvent(video) {
    const videoRecorded = {
        title: video.name, path: videoDirPath, extension: defaultVideoExtension,
    };

    axios
        .post(serverUrl + "/video-recorded", videoRecorded)
        .then(function (response) {
            console.log("Published data: " + JSON.stringify(videoRecorded));
            console.log("Response: " + JSON.stringify(response.data));
        })
        .catch(function (error) {
            console.log(error);
        });
}

async function initRedis() {
    redisClient.on("error", function (error) {
        console.error("Redis Client Error: ", error);
    })

    await redisClient.connect();

    let maxRetries = 3;
    while (!redisClient.isReady && maxRetries > 0) {
        await sleep(1000 * (4 - maxRetries));
        maxRetries--;
    }

    if (!redisClient.isReady) {
        console.error("Failed to connect to Redis");
        return false;
    }

    console.log("Redis connected");
    return true;
}

async function getVideoResumeMarker(videoSlug) {
    const marker = await redisClient.get(videoSlug);
    if (!marker) {
        return 0;
    }

    return parseInt(marker, 10);
}

async function setVideoResumeMarker(videoSlug, marker) {
    await redisClient.set(videoSlug, marker);
}

async function deleteVideoResumeMarker(videoSlug) {
    await redisClient.del(videoSlug);
}

function chunks(array, size) {
    return Array.from({length: Math.ceil(array.length / size)}, (v, i) =>
        array.slice(i * size, i * size + size)
    );
}

function makeDirIfNotExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, {recursive: true});
    }
}

function getProgress(video, resumeMarker) {
    return ((resumeMarker / video.lessons.length) * 100).toFixed(1);
}

async function recordVideo(video) {
    console.log("Recording video: " + video.name + " with " + video.lessons.length + " lessons");
    console.log("Chunk size: " + chunkSize);

    const eta = video.lessons.reduce((acc, lesson) => acc + lesson.duration, video.lessons.length);
    console.log("ETA: " + eta + " min");

    const page = await browser.newPage();

    const {width, height} = await page.evaluate(() => {
        return {
            width: window.innerWidth, height: window.innerHeight
        };
    });
    await page.setViewport({
        width, height,
    });

    const loginResult = await loginWithRetry(page);
    if (!loginResult) {
        return;
    }

    let resumeMarker = await getVideoResumeMarker(video.slug);
    console.log("Resume marker: " + resumeMarker);

    const remainedLessons = video.lessons.slice(resumeMarker);
    const lessonChunks = chunks(remainedLessons, chunkSize);
    console.log("Lesson chunks: " + lessonChunks.length);

    makeDirIfNotExists(path.join(videoDirPath, video.slug));

    try {
        for (const chunk of lessonChunks) {
            const videoFile = fs.createWriteStream(path.join(videoDirPath, video.slug, video.name + "_" + resumeMarker + "." + defaultVideoExtension));
            const stream = await getStream(page, {audio: true, video: true});

            stream.on("error", (error) => {
                console.error("Stream error: " + error + " for video: " + video.name + " at marker: " + resumeMarker);
            });

            stream.on("pipe", async () => {
                console.log("Stream ended for video: " + video.name + " at marker: " + resumeMarker);
                await deleteVideoResumeMarker(video.slug);

                await stream.destroy();
                videoFile.close();
            });

            await sleep(5000);
            for (const lesson of chunk) {
                await setVideoResumeMarker(video.slug, resumeMarker);
                await recordLesson(page, video.slug, lesson);
                resumeMarker++;
            }

            stream.pipe(videoFile);

            console.log("Chunk recorded: " + video.name + " at marker: " + resumeMarker);
            console.log("Progress: " + getProgress(video, resumeMarker) + "%");
        }
    } catch (e) {
        console.error("Error: " + e);
    }

    console.log("Video recorded: " + video.name);
    // await publishVideoRecordedEvent(video);
}

async function loginWithRetry(page) {
    let loginResult = await login(page);
    let retries = 3;
    while (!loginResult && retries > 0) {
        console.log("Retrying login...");
        loginResult = await login(page);
        retries--;
    }

    if (!loginResult) {
        console.error("Failed to login");
        return false;
    }

    console.log("Logged in successfully");
    return true;
}

async function login(page) {
    await page.goto(config.loginUrl, {timeout: 0});

    await page.locator('#user\\[email\\]').fill(email);
    await page.locator('#user\\[password\\]').fill(password);
    await sleep(5000);
    const sessionId = await page.$eval('#main-content > div > div > article > form', el => el.getAttribute('id'));

    await page.locator(`#${sessionId} > div.form__button-group > button`).click();
    await page.waitForNavigation();
    // await sleep(5000);

    const pageUrl = await page.url();
    console.log("Page URL: " + pageUrl);
    if (pageUrl === config.loginUrl) {
        console.error("Login failed");
        return false;
    }

    return true;
}

async function recordLesson(page, videoSlug, lesson) {
    console.log("Recording lesson: " + lesson.name + " (" + lesson.duration + " minutes)");
    const videoUrl = getVideoUrl({
        courseSlug: videoSlug, lessonId: lesson.id, lessonSlug: lesson.slug
    });

    await page.goto(videoUrl, {timeout: 0});
    await waitForVideo(lesson.duration + 1);
}

function getVideoUrl(options) {
    let courseUrl = config.courseUrl;

    courseUrl = courseUrl.replace("<course-slug>", options.courseSlug);
    courseUrl = courseUrl.replace("<lesson-id>", options.lessonId);
    courseUrl = courseUrl.replace("<lesson-slug>", options.lessonSlug);

    return courseUrl;
}

async function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function waitForVideo(minutes) {
    return new Promise((resolve) => {
        setTimeout(resolve, minutes * 60 * 1000);
    });
}

async function main() {
    const video = config.courses[videoId];

    const redisConnected = await initRedis();
    if (!redisConnected) {
        return;
    }

    await recordVideo(video);

    await browser.close();
}

main().catch(e => console.error(e));