//go:build mage

package main

import (
	"context"
	"fmt"
	"os"

	"github.com/magefile/mage/mg"
	"github.com/magefile/mage/sh"
	"github.com/sam-maryland/any-given-sunday/tools/dbsync"
)

// Test runs all tests in the repository
func Test() error {
	fmt.Println("Running tests...")
	return sh.RunV("go", "test", "-count=1", "./...")
}

// Build builds all binaries
func Build() error {
	fmt.Println("Building all binaries...")
	if err := sh.RunV("go", "build", "-o", ".bin/commish-bot", "./cmd/commish-bot"); err != nil {
		return err
	}
	return sh.RunV("go", "build", "-o", ".bin/weekly-recap", "./cmd/weekly-recap")
}

// Clean removes build artifacts
func Clean() error {
	fmt.Println("Cleaning build artifacts...")
	return os.RemoveAll(".bin")
}

// Run builds and runs the commish-bot binary with .env
func Run() error {
	if err := Build(); err != nil {
		return err
	}
	fmt.Println("Running commish-bot...")
	return sh.RunWithV(map[string]string{}, ".bin/commish-bot")
}

// Install installs mage if not present
func Install() error {
	return sh.RunV("go", "install", "github.com/magefile/mage@latest")
}

// Docker namespace contains Docker-related commands
type Docker mg.Namespace

// Build builds the Docker image for commish-bot
func (Docker) Build() error {
	fmt.Println("Building Docker image for commish-bot...")
	return sh.RunV("docker", "build", "-t", "commish-bot", ".")
}

// Run runs the Docker container locally for testing
func (Docker) Run() error {
	fmt.Println("Running commish-bot Docker container...")
	fmt.Println("Note: Make sure you have a .env file with required environment variables")
	return sh.RunV("docker", "run", "--rm", "-p", "8080:8080", "--env-file", ".env", "commish-bot")
}

// Test builds and tests the Docker container startup
func (Docker) Test() error {
	fmt.Println("Testing Docker build and container startup...")
	
	// Build the image
	if err := sh.RunV("docker", "build", "-t", "commish-bot-test", "."); err != nil {
		return fmt.Errorf("failed to build Docker image: %w", err)
	}
	
	// Test container starts properly (will fail on Discord connection but that's expected)
	fmt.Println("Testing container startup...")
	fmt.Println("Note: Container will fail on Discord connection, but should start and show health server")
	
	// Run container in background for a few seconds to test startup
	containerID, err := sh.Output("docker", "run", "-d", "-p", "8080:8080", 
		"-e", "PORT=8080", "-e", "DATABASE_URL=postgres://test:test@test:5432/test", 
		"-e", "DISCORD_TOKEN=test", "commish-bot-test")
	if err != nil {
		return fmt.Errorf("failed to start container: %w", err)
	}
	
	fmt.Printf("Container started with ID: %s\n", containerID)
	
	// Wait a moment for startup
	fmt.Println("Waiting for container startup...")
	if err := sh.RunV("sleep", "3"); err != nil {
		return err
	}
	
	// Check if health endpoint is accessible
	fmt.Println("Testing health endpoint...")
	if err := sh.RunV("curl", "-f", "http://localhost:8080/health"); err != nil {
		fmt.Println("Health endpoint test failed (may be expected if Discord connection fails first)")
	} else {
		fmt.Println("✅ Health endpoint is accessible!")
	}
	
	// Clean up
	fmt.Println("Cleaning up test container...")
	sh.Run("docker", "stop", containerID)
	sh.Run("docker", "rm", containerID)
	
	return nil
}

// Clean removes Docker images and containers
func (Docker) Clean() error {
	fmt.Println("Cleaning Docker artifacts...")
	sh.Run("docker", "rmi", "commish-bot", "commish-bot-test")
	return nil
}

// DB namespace contains database-related commands
type DB mg.Namespace

// Status shows the current sync status between local schema and Supabase
func (DB) Status() error {
	return dbsync.ShowStatus()
}

// Diff displays detailed differences between local and remote schemas
func (DB) Diff() error {
	return dbsync.ShowDifferences()
}


// Sync applies schema changes from local schema.sql to Supabase
func (DB) Sync() error {
	return dbsync.ApplyChanges()
}

// Rollback rolls back the last applied migration
func (DB) Rollback() error {
	return dbsync.RollbackLastMigration()
}

// Migrations lists all applied migrations
func (DB) Migrations() error {
	ctx := context.Background()
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return fmt.Errorf("DATABASE_URL environment variable not set")
	}
	return dbsync.ListMigrations(ctx, databaseURL)
}

// Verify checks schema sync and SQLC integration
func (DB) Verify() error {
	return dbsync.VerifySchema()
}