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

// Build builds the commish-bot binary
func Build() error {
	fmt.Println("Building commish-bot...")
	return sh.RunV("go", "build", "-o", "bin/commish-bot", "./cmd/commish-bot")
}

// Clean removes build artifacts
func Clean() error {
	fmt.Println("Cleaning build artifacts...")
	return os.RemoveAll("bin")
}

// Run builds and runs the commish-bot binary with .env
func Run() error {
	if err := Build(); err != nil {
		return err
	}
	fmt.Println("Running commish-bot...")
	return sh.RunWithV(map[string]string{}, "bin/commish-bot")
}

// Install installs mage if not present
func Install() error {
	return sh.RunV("go", "install", "github.com/magefile/mage@latest")
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