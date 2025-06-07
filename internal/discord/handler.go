package discord

import (
	"context"
	"log"

	"github.com/sam-maryland/any-given-sunday/internal/dependency"
	"github.com/sam-maryland/any-given-sunday/internal/interactor"
	"github.com/sam-maryland/any-given-sunday/pkg/config"

	"github.com/bwmarrin/discordgo"
)

// Handler handles Discord events
type Handler struct {
	session    *discordgo.Session
	interactor interactor.Interactor
}

// NewHandler creates a new Handler
func NewHandler(cfg *config.Config, chain *dependency.Chain, interactor interactor.Interactor) *Handler {
	registerCommands(cfg, chain)
	h := &Handler{
		session:    chain.Discord,
		interactor: interactor,
	}
	chain.Discord.AddHandler(h.Handle)
	chain.Discord.AddHandler(h.OnGuildMemberAdd)
	chain.Discord.AddHandler(h.HandleComponentInteraction)
	return h
}

// Handle handles Discord events
func (h *Handler) Handle(s *discordgo.Session, i *discordgo.InteractionCreate) {
	if i.Type != discordgo.InteractionApplicationCommand {
		return
	}

	ctx := context.Background()

	log.Printf("received command: %s", i.ApplicationCommandData().Name)

	switch i.ApplicationCommandData().Name {
	case commandNameCareerStats:
		h.handleCareerStatsCommand(ctx, s, i)
	case commandNameStandings:
		h.handleStandingsCommand(ctx, s, i)
	case commandNameWeeklySummary:
		h.handleWeeklySummaryCommand(ctx, s, i)
	default:
		log.Printf("unknown command name: %s", i.ApplicationCommandData().Name)
	}

	log.Printf("handled command: %s", i.ApplicationCommandData().Name)
}

const (
	commandNameCareerStats   = "career-stats"
	commandNameStandings     = "standings"
	commandNameWeeklySummary = "weekly-summary"
)

// registerCommands registers Discord bot commands that are accessible with slash commands (i.e. "/standings 2024")
func registerCommands(cfg *config.Config, c *dependency.Chain) {
	commands := []*discordgo.ApplicationCommand{
		{
			Name:        commandNameCareerStats,
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
		{
			Name:        commandNameStandings,
			Description: "Get the standings for a specific year",
			Options: []*discordgo.ApplicationCommandOption{
				{
					Type:        discordgo.ApplicationCommandOptionNumber,
					Name:        "year",
					Description: "The year to get standings for",
					Required:    false,
				},
			},
		},
		{
			Name:        commandNameWeeklySummary,
			Description: "Generate weekly summary with high score winner and updated standings",
			Options: []*discordgo.ApplicationCommandOption{
				{
					Type:        discordgo.ApplicationCommandOptionNumber,
					Name:        "year",
					Description: "The year to generate summary for",
					Required:    false,
				},
			},
		},
	}

	for _, command := range commands {
		log.Printf("registering command: %s", command.Name)
		_, err := c.Discord.ApplicationCommandCreate(cfg.AppID, cfg.GuildID, command)
		if err != nil {
			log.Fatalf("cannot create command %s: %v", command.Name, err)
		}
	}
}
