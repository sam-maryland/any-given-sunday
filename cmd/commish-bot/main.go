package main

import (
	"any-given-sunday/internal/dependency"
	"any-given-sunday/internal/discord"
	"any-given-sunday/internal/interactor"
	"any-given-sunday/pkg/config"
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/bwmarrin/discordgo"
)

func main() {
	cfg := config.InitConfig()

	c := dependency.NewDependencyChain(context.Background(), cfg)

	i := interactor.NewInteractor(c)

	registerDiscordCommands(cfg, c)

	h := discord.NewHandler(c.Discord, i)

	c.Discord.AddHandler(h.Handle)

	// Open a connection to Discord
	if err := c.Discord.Open(); err != nil {
		log.Fatal("Error opening connection to Discord:", err)
		return
	}

	log.Println("Bot is now running. Press CTRL+C to exit.")

	// Handle SIGINT and SIGTERM signals to gracefully shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	// Wait for signal
	<-stop

	// Close the database connection pool
	c.Pool.Close()
	log.Println("Bot has stopped.")
}

func registerDiscordCommands(cfg *config.Config, c *dependency.Chain) {
	commands := []*discordgo.ApplicationCommand{
		{
			Name:        "career-stats",
			Description: "Get career stats for a specific user",
			Options: []*discordgo.ApplicationCommandOption{
				{
					Type:        discordgo.ApplicationCommandOptionUser,
					Name:        "user",
					Description: "The user to get stats for",
					Required:    true,
				},
			},
		},
	}

	for _, command := range commands {
		_, err := c.Discord.ApplicationCommandCreate(cfg.Discord.AppID, cfg.Discord.GuildID, command)
		if err != nil {
			log.Fatalf("cannot create command %s: %v", command.Name, err)
		}
	}
}
