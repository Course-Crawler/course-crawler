import {getStream, launch} from "puppeteer-stream";
import * as fs from "node:fs";
import * as path from "path";
import axios from "axios";

const serverUrl = process.env.VIDEO_SERVER_ENDPOINT || "http://localhost:3000";
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

async function recordVideo(video) {
    console.log("Recording video: " + video.name);

    const videoFile = fs.createWriteStream(path.join(videoDirPath, video.name + "." + defaultVideoExtension));

    const page = await browser.newPage();

    const {width, height} = await page.evaluate(() => {
        return {
            width: window.innerWidth, height: window.innerHeight
        };
    });
    await page.setViewport({
        width, height,
    });

    await login(page);

    const stream = await getStream(page, {audio: true, video: true});

    for (const lesson of video.lessons) {
        await recordLesson(page, video, lesson);
        stream.pipe(videoFile);
    }

    await waitForVideo(1);

    // await stream.destroy();
    // videoFile.close();
    console.log("Video recorded: " + video.name);
    await publishVideoRecordedEvent(video);
}

async function login(page) {
    await page.goto(config.loginUrl, {timeout: 0});
    await page.locator('#user\\[email\\]').fill(email);
    await page.locator('#user\\[password\\]').fill(password);

    await sleep(1000);

    const sessionId = await page.$eval('#main-content > div > div > article > form', el => el.getAttribute('id'));
    await page.locator(`#${sessionId} > div.form__button-group > button`).click();
    await page.waitForNavigation();
}

async function recordLesson(page, video, lesson) {
    console.log("Recording lesson: " + lesson.name + " (" + lesson.duration + " minutes)");
    const videoUrl = getVideoUrl({
        courseSlug: video.slug, lessonId: lesson.id, lessonSlug: lesson.slug
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
    const videoId = parseInt(process.env.VIDEO_TO_RECORD_ID, 10);
    const video = config.courses[videoId];

    await recordVideo(video);

    await browser.close();
}

main().catch(e => console.error(e));