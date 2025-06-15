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
	return sh.RunV("go", "test", "./...")
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

// Install installs mage if not present
func Install() error {
	return sh.RunV("go", "install", "github.com/magefile/mage@latest")
}