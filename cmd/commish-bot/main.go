package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/sam-maryland/any-given-sunday/internal/dependency"
	"github.com/sam-maryland/any-given-sunday/internal/discord"
	"github.com/sam-maryland/any-given-sunday/internal/interactor"
	"github.com/sam-maryland/any-given-sunday/pkg/config"
)

func main() {
	log.Println("Starting Discord bot...")

	// Start health check server for Cloud Run FIRST
	// This ensures Cloud Run sees the service as ready immediately
	healthServer := startHealthServer()
	log.Println("Health server started - Cloud Run should see this as ready")

	// Load .env file for local development
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found (expected in production)")
	}

	// Channel to communicate Discord bot status
	botReady := make(chan bool, 1)
	
	// Initialize Discord bot in a goroutine so health server stays responsive
	go func() {
		log.Println("Starting Discord bot initialization...")
		if err := initializeDiscordBot(); err != nil {
			log.Printf("Discord bot initialization failed: %v", err)
			log.Println("Health server will continue running for Cloud Run")
			botReady <- false
		} else {
			log.Println("Discord bot initialization succeeded")
			botReady <- true
		}
	}()

	log.Println("Discord bot initialization started in background")

	// Wait for bot initialization to complete
	<-botReady
	log.Println("Discord bot initialization completed")

	// Handle SIGINT and SIGTERM signals to gracefully shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	// Wait for signal
	<-stop

	log.Println("Gracefully shutting down...")

	// Shutdown health server
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	if err := healthServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("Health server shutdown error: %v", err)
	}

	// Give some time for cleanup
	time.Sleep(2 * time.Second)
	log.Println("Discord bot stopped")
}

// startHealthServer starts a simple HTTP server for Cloud Run health checks
func startHealthServer() *http.Server {
	mux := http.NewServeMux()
	
	// Health check endpoint
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, `{"status":"healthy","service":"commish-bot","timestamp":"%s"}`, time.Now().Format(time.RFC3339))
	})

	// Readiness probe endpoint
	mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, `{"status":"ready","service":"commish-bot","timestamp":"%s"}`, time.Now().Format(time.RFC3339))
	})

	// Root endpoint for Cloud Run requirements
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, `{"service":"commish-bot","status":"running","timestamp":"%s"}`, time.Now().Format(time.RFC3339))
	})

	// Get port from environment variable (Cloud Run provides this)
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080" // Default port for Cloud Run
	}

	server := &http.Server{
		Addr:    ":" + port,
		Handler: mux,
	}

	go func() {
		log.Printf("Health server starting on port %s", port)
		if err := server.ListenAndServe(); err != http.ErrServerClosed {
			log.Printf("Health server error: %v", err)
		}
	}()

	return server
}

// initializeDiscordBot initializes the Discord bot components
func initializeDiscordBot() error {
	log.Println("Checking environment variables...")
	
	// Check required environment variables before proceeding
	requiredEnvVars := []string{
		"DATABASE_URL",
		"DISCORD_TOKEN", 
		"DISCORD_APP_ID",
		"DISCORD_GUILD_ID",
		"DISCORD_WELCOME_CHANNEL_ID",
	}
	
	for _, envVar := range requiredEnvVars {
		if os.Getenv(envVar) == "" {
			return fmt.Errorf("required environment variable %s is not set", envVar)
		}
	}
	log.Println("✅ All required environment variables are set")

	// Initialize configuration
	log.Println("Initializing configuration...")
	cfg := config.InitConfig()
	log.Println("✅ Configuration initialized")

	// Create context for application lifecycle
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Initialize dependency chain
	log.Println("Initializing dependency chain (database, Discord, etc.)...")
	c, err := dependency.NewDependencyChain(ctx, cfg)
	if err != nil {
		return fmt.Errorf("failed to initialize dependency chain: %w", err)
	}
	defer c.Pool.Close()
	defer c.Discord.Close()
	log.Println("✅ Dependency chain initialized")

	// Initialize business logic layer
	log.Println("Initializing business logic layer...")
	i := interactor.NewInteractor(c)
	log.Println("✅ Business logic layer initialized")

	// Initialize Discord handler
	log.Println("Initializing Discord handler...")
	handler := discord.NewHandler(cfg, c, i)
	if handler == nil {
		return fmt.Errorf("failed to initialize Discord handler")
	}
	log.Println("✅ Discord handler initialized")

	log.Printf("🎉 Bot is now running as %s. Discord bot ready!", c.Discord.State.User.Username)

	// Discord bot is now running - return to signal readiness
	// The bot will continue running via the Discord session's goroutines
	return nil
}
