package main

import (
	dapr "github.com/dapr/go-sdk/client"
	"github.com/gofiber/fiber/v2"
	"log"
)

type Video struct {
	Title     string `json:"title"`
	Path      string `json:"path"`
	Extension string `json:"extension"`
}

var (
	pubsubName = "pubsub"
	topicName  = "video-recorded"
)

func main() {
	// Create a new Dapr client
	daprClient, err := dapr.NewClient()
	if err != nil {
		log.Fatalf("Error creating Dapr client: %v", err)
	}
	defer daprClient.Close()

	// Initialize a new Fiber app
	app := fiber.New()

	app.Get("/health", func(c *fiber.Ctx) error {
		return c.SendString("healthy")
	})

	// Handle the /video-recorded route
	app.Post("/video-recorded", func(c *fiber.Ctx) error {
		// Parse the request body into a Video struct
		video := new(Video)
		if err := c.BodyParser(video); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": err.Error(),
			})
		}

		log.Printf("Received video: %+v", video)

		// Publish the video to the "video-recorded" topic
		if err := daprClient.PublishEvent(c.Context(), pubsubName, topicName, video); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": err.Error(),
			})
		}

		log.Printf("Published video: %+v", video)

		// Return a success message
		return c.JSON(fiber.Map{
			"message": "Video recorded successfully",
		})
	})

	// Start the server on port 3000
	log.Fatal(app.Listen(":3000"))
}
