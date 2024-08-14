package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path"

	"github.com/dapr/go-sdk/service/common"
	daprd "github.com/dapr/go-sdk/service/http"
	ffmpeg "github.com/u2takey/ffmpeg-go"
)

var sub = &common.Subscription{
	PubsubName: "pubsub",
	Topic:      "video-recorded",
	Route:      "/videos",
}

type Video struct {
	Title     string `json:"title"`
	Path      string `json:"path"`
	Extension string `json:"extension"`
}

func (v *Video) RawVideoPath() string {
	return path.Join(v.Path, fmt.Sprintf("%s.%s", v.Title, v.Extension))
}

func (v *Video) CompressedVideoPath() string {
	return path.Join(v.Path, fmt.Sprintf("%s_compressed.%s", v.Title, v.Extension))
}

func main() {
	appPort := os.Getenv("APP_PORT")
	if appPort == "" {
		appPort = "8080"
	}

	// Create the new server on appPort and add a topic listener
	s := daprd.NewService(":" + appPort)
	err := s.AddTopicEventHandler(sub, eventHandler)
	if err != nil {
		log.Fatalf("error adding topic subscription: %v", err)
	}

	// Start the server
	err = s.Start()
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("error listenning: %v", err)
	}
}

func eventHandler(ctx context.Context, e *common.TopicEvent) (retry bool, err error) {
	video := Video{}

	err = e.Struct(&video)
	if err != nil {
		log.Fatalf("error decoding data: %v", err)
		return false, err
	}
	log.Printf("Subscriber received: %v\n", video)

	err = compressVideo(&video)
	if err != nil {
		log.Fatalf("error compressing video: %v", err)
		return true, err
	}

	return false, nil
}

func compressVideo(video *Video) (err error) {
	// touch output compressed video file
	_, err = os.Create(video.CompressedVideoPath())
	if err != nil {
		return err
	}

	// ffmpeg -i input.mp4 -vcodec h264 -acodec mp2 output.mp4
	err = ffmpeg.
		Input(video.RawVideoPath()).
		Output(video.CompressedVideoPath(), ffmpeg.KwArgs{
			"vcodec": "h264",
			"acodec": "mp2",
		}).
		OverWriteOutput().
		ErrorToStdOut().
		Run()
	if err != nil {
		return err
	}

	// remove raw video file
	err = os.Remove(video.RawVideoPath())
	if err != nil {
		return err
	}

	return nil
}
