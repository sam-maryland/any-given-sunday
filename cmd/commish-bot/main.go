package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/joho/godotenv"
	"github.com/sam-maryland/any-given-sunday/internal/dependency"
	"github.com/sam-maryland/any-given-sunday/internal/discord"
	"github.com/sam-maryland/any-given-sunday/internal/interactor"
	"github.com/sam-maryland/any-given-sunday/pkg/config"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found")
	}

	cfg := config.InitConfig()

	c := dependency.NewDependencyChain(context.Background(), cfg)

	i := interactor.NewInteractor(c)

	_ = discord.NewHandler(cfg, c, i)

	log.Println("commish-bot is online")

	// Handle SIGINT and SIGTERM signals to gracefully shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	// Wait for signal
	<-stop

	// Close the database connection pool
	c.Pool.Close()
	log.Println("commish-bot has stopped.")
}
