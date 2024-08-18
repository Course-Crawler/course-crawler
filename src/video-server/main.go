package main

import (
	"encoding/json"
	dapr "github.com/dapr/go-sdk/client"
	"github.com/gofiber/fiber/v2"
	"log"
	"os"
	"sync"
)

type Video struct {
	Title        string `json:"title"`
	Slug         string `json:"slug"`
	ChunkDirPath string `json:"chunkDirPath"`
	Extension    string `json:"extension"`
	OutputPath   string `json:"outputPath"`
}

type VideoRecordingMarker struct {
	LessonIndex int    `json:"lessonIndex"`
	LessonSlug  string `json:"lessonSlug"`
}

var (
	serverPort   = os.Getenv("SERVER_PORT")
	pubsubName   = os.Getenv("DAPR_PUBSUB_NAME")
	pubTopicName = os.Getenv("DAPR_PUB_TOPIC")
	stateStore   = os.Getenv("DAPR_STATE_STORE_NAME")
	daprClient   dapr.Client
	once         sync.Once
)

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
	// Initialize a new Fiber app
	app := fiber.New()

	app.Get("/health", healthHandler)
	app.Post("/videos/record", videoRecordedHandler)
	app.Post("/videos/:videoSlug/markers", setVideoRecordingMarkerHandler)
	app.Get("/videos/:videoSlug/markers", getVideoRecordingMarkerHandler)
	app.Delete("/videos/:videoSlug/markers", deleteVideoRecordingMarkerHandler)

	log.Fatal(app.Listen(":" + serverPort))
}

func healthHandler(c *fiber.Ctx) error {
	return c.SendString("healthy")
}

func videoRecordedHandler(c *fiber.Ctx) error {
	daprClient = GetDaprClient()

	// Parse the request body into a Video struct
	video := new(Video)
	if err := c.BodyParser(video); err != nil {
		log.Printf("Failed to parse video: %s", err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	log.Printf("Received video: %+v", video)

	// Publish the video to the "video-recorded" topic
	if err := daprClient.PublishEvent(c.Context(), pubsubName, pubTopicName, video); err != nil {
		log.Printf("Failed to publish video: %s", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	log.Printf("Published video for merging: %+v", video)

	// Return a success message
	return c.JSON(fiber.Map{
		"message": "Video recorded event has successfully been sent",
	})
}

func setVideoRecordingMarkerHandler(c *fiber.Ctx) error {
	daprClient = GetDaprClient()

	videoSlug := c.Params("videoSlug")
	videoRecordingMarker := new(VideoRecordingMarker)
	if err := c.BodyParser(videoRecordingMarker); err != nil {
		log.Printf("Failed to parse video recording marker: %s", err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	log.Printf("Setting video recording marker for video %s: %+v", videoSlug, videoRecordingMarker)
	key := videoSlug
	value, err := json.Marshal(videoRecordingMarker)
	if err != nil {
		log.Printf("Failed to marshal video recording marker: %s", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	if err := daprClient.SaveState(c.Context(), stateStore, key, value, nil); err != nil {
		log.Printf("Failed to save video recording marker: %s", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	log.Printf("Set video recording marker for video %s: %+v", videoSlug, videoRecordingMarker)

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"message": "Video recording marker has successfully been set",
	})
}

func getVideoRecordingMarkerHandler(c *fiber.Ctx) error {
	daprClient = GetDaprClient()

	videoSlug := c.Params("videoSlug")
	key := videoSlug
	value, err := daprClient.GetState(c.Context(), stateStore, key, nil)
	if err != nil {
		log.Printf("Failed to get video recording marker: %s", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	if value == nil {
		log.Printf("Video recording marker for video %s not found", videoSlug)
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Video recording marker not found",
		})
	}

	videoRecordingMarker := new(VideoRecordingMarker)
	if err := json.Unmarshal(value.Value, videoRecordingMarker); err != nil {
		log.Printf("No video marker found for %s video: %s", videoSlug, err)
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Video recording marker not found",
		})
	}

	log.Printf("Got video recording marker for video %s: %+v", videoSlug, videoRecordingMarker)

	return c.JSON(videoRecordingMarker)
}

func deleteVideoRecordingMarkerHandler(c *fiber.Ctx) error {
	daprClient = GetDaprClient()

	videoSlug := c.Params("videoSlug")
	key := videoSlug
	if err := daprClient.DeleteState(c.Context(), stateStore, key, nil); err != nil {
		log.Printf("Failed to delete video recording marker: %s", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	log.Printf("Deleted video recording marker for video %s", videoSlug)

	return c.JSON(fiber.Map{
		"message": "Video recording marker has successfully been deleted",
	})
}
