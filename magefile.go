//go:build mage

package main

import (
	"fmt"
	"os"

	"github.com/magefile/mage/sh"
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