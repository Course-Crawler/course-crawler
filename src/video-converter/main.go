package main

import (
	"context"
	"errors"
	"fmt"
	dapr "github.com/dapr/go-sdk/client"
	"log"
	"net/http"
	"os"
	"path"
	"sync"

	"github.com/dapr/go-sdk/service/common"
	daprd "github.com/dapr/go-sdk/service/http"
	ffmpeg "github.com/u2takey/ffmpeg-go"
)

var (
	serverPort           = os.Getenv("SERVER_PORT")
	pubsubName           = os.Getenv("DAPR_PUBSUB_NAME")
	subTopicName         = os.Getenv("DAPR_SUB_TOPIC")
	pubTopicName         = os.Getenv("DAPR_PUB_TOPIC")
	subscriptionEndpoint = os.Getenv("DAPR_PUBSUB_SUBSCRIPTION_ENDPOINT")
	sub                  = &common.Subscription{
		PubsubName: pubsubName,
		Topic:      subTopicName,
		Route:      subscriptionEndpoint,
	}
	daprClient dapr.Client
	once       sync.Once
)

type Video struct {
	Title              string `json:"title"`
	Path               string `json:"path"`
	RawExtension       string `json:"rawExtension"`
	ConvertedExtension string `json:"convertedExtension"`
}

func (v *Video) RawVideoPath() string {
	return path.Join(v.Path, fmt.Sprintf("%s.%s", v.Title, v.RawExtension))
}

func (v *Video) ConvertedVideoPath() string {
	return path.Join(v.Path, fmt.Sprintf("%s.%s", v.Title, v.ConvertedExtension))
}

type ConvertedVideo struct {
	Title     string `json:"title"`
	Path      string `json:"path"`
	Extension string `json:"extension"`
}

func NewConvertedVideo(video *Video) *ConvertedVideo {
	return &ConvertedVideo{
		Title:     video.Title,
		Path:      video.Path,
		Extension: video.ConvertedExtension,
	}
}

func GetDaprClient() dapr.Client {
	once.Do(func() {
		instance, err := dapr.NewClient()
		if err != nil {
			log.Fatalf("Failed to create Dapr client: %s", err)
		}
		daprClient = instance
	})
	return daprClient
}

func main() {
	// Create the new server on appPort and add a topic listener
	s := daprd.NewService(":" + serverPort)
	err := s.AddTopicEventHandler(sub, eventHandler)
	if err != nil {
		log.Fatalf("error adding topic subscription: %v", err)
	}

	// Start the server
	err = s.Start()
	log.Printf("subscriber listening on: %s\n", serverPort)
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("error listenning: %v", err)
	}
}

func eventHandler(ctx context.Context, e *common.TopicEvent) (retry bool, err error) {
	daprClient = GetDaprClient()
	video := Video{}

	err = e.Struct(&video)
	if err != nil {
		log.Fatalf("error decoding data: %v", err)
		return false, err
	}
	log.Printf("Subscriber received: %v\n", video)

	var convertedVideo *ConvertedVideo
	convertedVideo, err = convertVideo(&video)
	if err != nil {
		log.Fatalf("error converting video: %v", err)
		return true, err
	}

	// Publish the converted video
	if err := daprClient.PublishEvent(ctx, pubsubName, pubTopicName, convertedVideo); err != nil {
		log.Fatalf("error publishing event: %v", err)
		return true, err
	}

	log.Printf("Published video for compressing: %+v", convertedVideo)

	return false, nil
}

func convertVideo(video *Video) (convertedVideo *ConvertedVideo, err error) {
	// touch output converted video file
	_, err = os.Create(video.ConvertedVideoPath())
	defer removeFile(video.ConvertedVideoPath())
	if err != nil {
		return nil, err
	}

	log.Printf("Converted video file created successfully: %s\n", video.ConvertedVideoPath())

	// ffmpeg -i input.webm -c copy output.mp4
	log.Printf("Converting video: %s\n", video.RawVideoPath())
	err = ffmpeg.
		Input(video.RawVideoPath()).
		Output(video.ConvertedVideoPath()).
		OverWriteOutput().
		Run()
	if err != nil {
		return nil, err
	}

	// remove raw video file
	removeFile(video.RawVideoPath())

	log.Printf("Video converted successfully: %s\n", video.ConvertedVideoPath())

	convertedVideo = NewConvertedVideo(video)
	return convertedVideo, nil
}

func removeFile(name string) {
	err := os.Remove(name)
	if err != nil {
		log.Fatalf("error removing file: %v", err)
	}
}
