import {getStream, launch} from "puppeteer-stream";
import * as fs from "node:fs";
import * as path from "path";
import axios from "axios";

const videoDirPath = process.env.VIDEO_DIR_PATH || "/temp/videos/";
const videoChunkDirPartialPath = process.env.VIDEO_CHUNK_DIR_PARTIAL_PATH || "chunks";
const defaultVideoExtension = process.env.DEFAULT_VIDEO_EXTENSION || "webm";
const configPath = process.env.CONFIG_PATH || "./config.json";

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
        title: video.name,
        slug: video.slug,
        chunkDirPath: path.join(videoDirPath, video.slug, videoChunkDirPartialPath),
        extension: defaultVideoExtension,
        outputPath: path.join(videoDirPath, video.slug)
    };

    axios
        .post(config.server.baseUrl + config.server.videoRecordedEndpoint, videoRecorded)
        .then(function (response) {
            console.log("Published data: " + JSON.stringify(videoRecorded));
            console.log("Response: " + JSON.stringify(response.data));
        })
        .catch(function (error) {
            console.log(error);
        });
}

async function setVideoMarker(video, lesson) {
    const videoMarker = {
        lessonIndex: video.lessons.indexOf(lesson), lessonSlug: lesson.slug,
    }

    let endpoint = config.server.baseUrl + config.server.videoMarkerEndpoint;
    endpoint = endpoint.replace("<video-slug>", video.slug);

    axios
        .post(endpoint, videoMarker)
        .then(function (response) {
            console.log("Video marker set: " + JSON.stringify(videoMarker));
            console.log("Response: " + JSON.stringify(response.data));
        })
        .catch(function (error) {
            console.log(error);
        });
}

async function getWithRetry(url, config, retries = 3, delay = 1000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await axios.get(url, config);
            if (response.status === 200) {
                return response.data;
            }
        } catch (error) {
            console.log(`Attempt ${attempt} failed: ${error}`);
            if (attempt < retries) {
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
}

async function getVideoMarker(video) {
    let endpoint = config.server.baseUrl + config.server.videoMarkerEndpoint;
    endpoint = endpoint.replace("<video-slug>", video.slug);

    const axiosConf = {
        validateStatus: (status) => {
            return (status >= 200 && status < 300) || status === 404
        }
    };

    try {
        return await getWithRetry(endpoint, axiosConf);
    } catch (error) {
        console.log(error);
    }

    return null;
}

async function removeVideoMarker(video) {
    let endpoint = config.server.baseUrl + config.server.videoMarkerEndpoint;
    endpoint = endpoint.replace("<video-slug>", video.slug);

    axios
        .delete(endpoint)
        .then(function (response) {
            console.log("Video marker deleted");
            console.log("Response: " + JSON.stringify(response.data));
        })
        .catch(function (error) {
            console.log(error);
        });
}

class VideoRecorder {
    video;
    videoMarkerIndex;
    page;
    videoFile;
    stream;

    constructor(video) {
        this.video = video;
        this.videoMarkerIndex = 0;
    }

    async init() {
        const videoMarker = await getVideoMarker(this.video);
        if (videoMarker != null) {
            this.videoMarkerIndex = videoMarker.lessonIndex
        }

        this.page = await browser.newPage();

        const {width, height} = await this.page.evaluate(() => {
            return {
                width: window.innerWidth, height: window.innerHeight
            };
        });
        await this.page.setViewport({
            width, height,
        });

        const videoFilePath = path.join(videoDirPath, this.video.slug, videoChunkDirPartialPath, this.video.slug + "_" + this.videoMarkerIndex + "." + defaultVideoExtension);
        createDirIfNotExists(path.dirname(videoFilePath));

        this.videoFile = fs.createWriteStream(videoFilePath);
        this.stream = await getStream(this.page, {audio: true, video: true});
    }

    async recordVideo() {
        console.log("Recording video: " + this.video.name);

        await login(this.page);
        this.record();

        for (let i = this.videoMarkerIndex; i < this.video.lessons.length; i++) {
            const lesson = this.video.lessons[i];
            await setVideoMarker(this.video, lesson);

            await playLesson(this.page, this.video, lesson);
            this.record();
        }

        await sleep(1, 'min');

        console.log("Video recorded: " + this.video.name);
        await removeVideoMarker(this.video);
        await publishVideoRecordedEvent(this.video);
    }

    record() {
        this.stream.pipe(this.videoFile);
    }

    async close() {
        await this.stream.destroy();
        this.videoFile.close();
    }
}

async function login(page) {
    await page.goto(config.loginUrl, {timeout: 0});
    await page.locator('#user\\[email\\]').fill(email);
    await page.locator('#user\\[password\\]').fill(password);
    await sleep(4, 'sec');

    const sessionId = await page.$eval('#main-content > div > div > article > form', el => el.getAttribute('id'));
    await page.locator(`#${sessionId} > div.form__button-group > button`).click();
    await sleep(6, 'sec');
    // await page.waitForNavigation();

    console.log("Logged in successfully");
}

async function playLesson(page, video, lesson) {
    console.log("Recording lesson: " + lesson.name + " (" + lesson.duration + " minutes)");
    const videoUrl = getVideoUrl({
        courseSlug: video.slug, lessonId: lesson.id, lessonSlug: lesson.slug
    });

    await page.goto(videoUrl, {timeout: 0});
    await sleep(lesson.duration + 1, 'min');
}

function getVideoUrl(options) {
    let courseUrl = config.courseUrl;

    courseUrl = courseUrl.replace("<course-slug>", options.courseSlug);
    courseUrl = courseUrl.replace("<lesson-id>", options.lessonId);
    courseUrl = courseUrl.replace("<lesson-slug>", options.lessonSlug);

    return courseUrl;
}

function createDirIfNotExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        console.log("Creating directory: " + dirPath);
        fs.mkdirSync(dirPath, {recursive: true});
    }
}

async function sleep(time, opt = 'ms') {
    switch (opt) {
        case 'sec':
            time = time * 1000;
            break;
        case 'min':
            time = time * 1000 * 60;
            break;
    }

    return new Promise(resolve => setTimeout(resolve, time));
}

async function main() {
    const videoId = parseInt(process.env.VIDEO_TO_RECORD_ID, 10);
    const video = config.courses[videoId];

    const videoRecorder = new VideoRecorder(video);
    await videoRecorder.init();

    await videoRecorder.recordVideo();

    await videoRecorder.close();
    await browser.close();
}

main().catch(e => console.error(e));