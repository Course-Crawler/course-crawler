import {DaprClient} from "@dapr/dapr";

const daprHost = process.env.DAPR_HOST || "http://localhost";
const daprPort = process.env.DAPR_HTTP_PORT || "3500";
const pubSubName = "pubsub";
const pubSubTopic = "video-recorded";

async function main() {
    const client = new DaprClient({daprHost, daprPort});

    const video = {
        title: "Getting Started with Microservices Course",
        path: "/temp/videos",
        extension: "mp4",
    };

    await client.pubsub.publish(pubSubName, pubSubTopic, video);
    console.log("Published data: " + JSON.stringify(video));
}

main().catch(e => console.error(e));