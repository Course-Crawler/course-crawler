import {getStream, launch} from "puppeteer-stream";
import * as fs from "node:fs";
import * as path from "path";
import axios from "axios";

const serverUrl = process.env.VIDEO_SERVER_ENDPOINT || "http://localhost:3000";
const videoDirPath = process.env.VIDEO_DIR_PATH || "/temp/videos/";
const defaultVideoExtension = process.env.DEFAULT_VIDEO_EXTENSION || "webm";
const configPath = "config.json";

const email = process.env.EMAIL;
const password = process.env.PASSWORD;

const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const browser = await launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--disable-setuid-sandbox", "--disable-features=dbus"]
});

async function publishVideoRecordedEvent(video) {
    const videoRecorded = {
        title: video.title, path: videoDirPath, extension: defaultVideoExtension,
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
    console.log("Recording video: " + video.title);

    const videoFile = fs.createWriteStream(path.join(videoDirPath, video.title + "." + defaultVideoExtension));

    const page = await browser.newPage();
    await page.goto("https://courses.dometrain.com/users/sign_in", {timeout: 0});

    const stream = await getStream(page, {audio: true, video: true});

    await page.locator('#user\\[email\\]').fill(email);
    await page.locator('#user\\[password\\]').fill(password);
    await sleep(1000);
    let sessionId = await page.$eval('#main-content > div > div > article > form', el => el.getAttribute('id'));
    console.log(sessionId);

    await page.locator(`#${sessionId} > div.form__button-group > button`).click();
    await sleep(3000);

    await page.goto(`https://courses.dometrain.com/courses/take/${video.slug}`, {timeout: 0});
    await sleep(20000);

    stream.pipe(videoFile);

    // await stream.destroy();
    // videoFile.close();
    console.log("Video recorded: " + video.title);

    await publishVideoRecordedEvent(video);
}

async function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function main() {
    const videoId = process.env.VDIEO_TO_RERORD_ID || 0;
    const video = config.courses[videoId];

    console.log(process.env.VIDEO_TO_RECORD_ID);
    console.log(video);
    console.log(config.courses);

    await recordVideo(video);

    await browser.close();
}

main().catch(e => console.error(e));