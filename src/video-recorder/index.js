import {getStream, launch} from "puppeteer-stream";
import * as fs from "node:fs";
import * as path from "path";
import axios from "axios";

const videoDirPath = process.env.VIDEO_DIR_PATH || "/temp/videos/";
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
        title: video.name, path: videoDirPath, extension: defaultVideoExtension,
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
        lessonIndex: video.lessons.indexOf(lesson),
        lessonSlug: lesson.slug,
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

async function getVideoMarker(video) {
    let endpoint = config.server.baseUrl + config.server.videoMarkerEndpoint;
    endpoint = endpoint.replace("<video-slug>", video.slug);

    const axiosConf = {
        validateStatus: (status) => {
            return (status >= 200 && status < 300) || status === 404
        }
    };

    try {
        const response = await axios.get(endpoint, axiosConf);
        if (response.status === 200) {
            return response.data
        }
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

async function recordVideo(video) {
    console.log("Recording video: " + video.name);

    const videoFile = fs.createWriteStream(path.join(videoDirPath, video.name + "." + defaultVideoExtension), {flags: 'a'});

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
    stream.pipe(videoFile);

    let lessonIndexToResumeFrom = 0;
    const videoMarker = await getVideoMarker(video);
    if (videoMarker != null) {
        lessonIndexToResumeFrom = videoMarker.lessonIndex;
    }

    for (let i = lessonIndexToResumeFrom; i < video.lessons.length; i++) {
        const lesson = video.lessons[i];
        await setVideoMarker(video, lesson);

        await playLesson(page, video, lesson);
        stream.pipe(videoFile);
    }

    await sleep(1, 'min');

    await stream.destroy();
    videoFile.close();

    console.log("Video recorded: " + video.name);
    await removeVideoMarker(video);
    await publishVideoRecordedEvent(video);
}

async function login(page) {
    await page.goto(config.loginUrl, {timeout: 0});
    await page.locator('#user\\[email\\]').fill(email);
    await page.locator('#user\\[password\\]').fill(password);

    await sleep(4000);

    const sessionId = await page.$eval('#main-content > div > div > article > form', el => el.getAttribute('id'));
    await page.locator(`#${sessionId} > div.form__button-group > button`).click();
    await page.waitForNavigation();
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

    await recordVideo(video);

    await browser.close();
}

main().catch(e => console.error(e));