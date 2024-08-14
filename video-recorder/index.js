import {DaprClient} from "@dapr/dapr";
import * as fs from "node:fs";

const daprHost = process.env.DAPR_HOST || "http://localhost";
const daprPort = process.env.DAPR_HTTP_PORT || "3500";
const pubSubName = "pubsub";
const pubSubTopic = "video-recorded";

const videoDirPath = process.env.VIDEO_DIR_PATH || "/temp/videos/";
const defaultVideoExtension = process.env.DEFAULT_VIDEO_EXTENSION || ".mp4";
const configPath = "config.json";

const client = new DaprClient({daprHost, daprPort});
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

async function publishVideoRecordedEvent(video) {
    const videoRecorded = {
        title: video.title,
        path: videoDirPath,
        extension: defaultVideoExtension,
    };

    await client.pubsub.publish(pubSubName, pubSubTopic, videoRecorded);
    console.log("Published data: " + JSON.stringify(videoRecorded));
}

async function recordVideo(video) {
    // Record video
    console.log("Recording video: " + video.title);
    await publishVideoRecordedEvent(video);
}

async function main() {
    const video = config.courses[1];
    await recordVideo(video);
}

main().catch(e => console.error(e));