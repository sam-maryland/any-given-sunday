package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/joho/godotenv"
	"github.com/sam-maryland/any-given-sunday/internal/app"
)

func main() {
	// Load .env file for local development
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found (expected in production)")
	}

	var mode string
	flag.StringVar(&mode, "mode", "", "Execution mode (weekly-recap)")
	flag.Parse()

	if mode != "weekly-recap" {
		log.Fatal("Invalid mode. Use --mode=weekly-recap")
	}

	ctx := context.Background()

	// Initialize the application
	application, err := app.NewWeeklyRecapApp()
	if err != nil {
		log.Fatalf("Failed to initialize weekly recap app: %v", err)
	}

	// Run the weekly recap workflow
	if err := application.RunWeeklyRecap(ctx); err != nil {
		log.Fatalf("Weekly recap failed: %v", err)
	}

	fmt.Println("✅ Weekly recap completed successfully!")
	os.Exit(0)
}
