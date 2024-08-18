package main

import (
	"context"
	"errors"
	"fmt"
	dapr "github.com/dapr/go-sdk/client"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/dapr/go-sdk/service/common"
	daprd "github.com/dapr/go-sdk/service/http"
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

type VideoChunk struct {
	ChunkName string
	ChunkId   int
	*os.File
}

func NewVideoChunk(filePath string) (*VideoChunk, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}

	chunkBaseName := path.Base(filePath)

	chunkFileName := strings.Split(chunkBaseName, ".")[0]
	chunkFileNameTokens := strings.Split(chunkFileName, "_")

	chunkId, err := strconv.Atoi(chunkFileNameTokens[len(chunkFileNameTokens)-1])
	if err != nil {
		return nil, err
	}

	return &VideoChunk{
		ChunkName: chunkBaseName,
		ChunkId:   chunkId,
		File:      file,
	}, nil
}

type Video struct {
	Title        string `json:"title"`
	Slug         string `json:"slug"`
	ChunkDirPath string `json:"chunkDirPath"`
	Extension    string `json:"extension"`
	OutputPath   string `json:"outputPath"`
}

func (v *Video) GetVideoChunks() ([]*VideoChunk, error) {
	files, err := os.ReadDir(v.ChunkDirPath)
	if err != nil {
		return nil, err
	}

	var chunks []*VideoChunk
	for _, file := range files {
		if file.IsDir() {
			continue
		}

		if !strings.HasPrefix(file.Name(), fmt.Sprintf("%s_", v.Slug)) {
			continue
		}

		if !strings.HasSuffix(file.Name(), fmt.Sprintf(".%s", v.Extension)) {
			continue
		}

		chunk, err := NewVideoChunk(path.Join(v.ChunkDirPath, file.Name()))
		if err != nil {
			return nil, err
		}
		chunks = append(chunks, chunk)
	}

	// sort chunks by id
	sort.Slice(chunks, func(i, j int) bool {
		return chunks[i].ChunkId < chunks[j].ChunkId
	})

	return chunks, nil
}

func (v *Video) MergedVideoPath() string {
	return path.Join(v.OutputPath, fmt.Sprintf("%s.%s", v.Title, v.Extension))
}

type MergedVideo struct {
	Title     string `json:"title"`
	Path      string `json:"path"`
	Extension string `json:"extension"`
}

func NewMergedVideo(video *Video) *MergedVideo {
	return &MergedVideo{
		Title:     video.Title,
		Path:      video.OutputPath,
		Extension: video.Extension,
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

	var mergedVideo *MergedVideo
	mergedVideo, err = mergeVideo(&video)
	if err != nil {
		log.Fatalf("error merging video: %v", err)
		return true, err
	}

	// Publish the merged video
	if err := daprClient.PublishEvent(ctx, pubsubName, pubTopicName, mergedVideo); err != nil {
		log.Fatalf("error publishing event: %v", err)
		return true, err
	}

	log.Printf("Published video for converting: %+v", mergedVideo)

	return false, nil
}

func mergeVideo(video *Video) (mergedVideo *MergedVideo, err error) {
	// get the list of video chunks
	chunks, err := video.GetVideoChunks()
	defer removeVideoChunks(chunks)
	if err != nil {
		return nil, err
	}

	// create the concat-list.txt file and write the list of video chunks names to it
	concatListFilePath := path.Join(video.ChunkDirPath, "concat-list.txt")
	concatListFile, err := os.Create(concatListFilePath)
	defer removeFile(concatListFilePath)

	if err != nil {
		return nil, err
	}

	for _, chunk := range chunks {
		_, err = concatListFile.WriteString(fmt.Sprintf("file '%s'\n", chunk.Name()))
		if err != nil {
			return nil, err
		}
	}

	// ffmpeg -avoid_negative_ts 1 -f concat -i concat-list.txt merged-video.webm
	args := []string{
		"-avoid_negative_ts", "1",
		"-f", "concat",
		"-i", concatListFilePath,
		video.MergedVideoPath(),
	}
	cmd := exec.Command("ffmpeg", args...)
	err = cmd.Run()
	if err != nil {
		return nil, err
	}

	mergedVideo = NewMergedVideo(video)
	return mergedVideo, nil
}

func removeFile(name string) {
	err := os.Remove(name)
	if err != nil {
		log.Fatalf("error removing file: %v", err)
	}
}

func removeVideoChunks(videoChunks []*VideoChunk) {
	for _, chunk := range videoChunks {
		removeFile(chunk.Name())
	}
}
