# course-crawler
Course crawling script for self-recording programming courses

## Architecture
- `video_recorder`: The main js script that records a given course inside a docker container using puppeteer with headless chrome
- `video_server`: A simple go Fiber server that publishes events (video recorded) and manages the state store of the system (resume markers)
- `video_compressor`: A simple go subscriber that listens to the events published by the server and compresses the video using ffmpeg
- `ancillary services`:
  - `dapr_placement`: Dapr placement service
  - `dapr sidecars`: Dapr sidecars for each service
  - `redis`: Redis for state store
  - `rabbitmq`: RabbitMQ for pub/sub
  - `zipkin`: Zipkin for tracing

## How to run
1. Git clone the repository and cd into it
2. Install docker and docker-compose
3. Install [scriptisto](https://repology.org/project/scriptisto/versions) for running the rust init script
4. Populate the `.env` file with the required environment variables as shown in the `.env.template` file
5. Assign execute permission to the init script: `chmod +x ./init.sh`
6. Run the init script: `./init.sh -r <replicas> -c <path_to_courses_to_record_file.csv>`
