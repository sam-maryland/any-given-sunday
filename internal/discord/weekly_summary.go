package discord

import (
	"context"
	"fmt"
	"log"

	"github.com/bwmarrin/discordgo"
	"github.com/sam-maryland/any-given-sunday/internal/format"
)

// handleWeeklySummaryCommand handles the /weekly-summary Discord command
func (h *Handler) handleWeeklySummaryCommand(ctx context.Context, s *discordgo.Session, i *discordgo.InteractionCreate) {
	// Extract year from command options, default to current year from latest league
	var year int
	options := i.ApplicationCommandData().Options
	if len(options) > 0 && options[0].Name == "year" {
		year = int(options[0].IntValue())
	}

	// If no year specified, get the latest league
	if year == 0 {
		league, err := h.interactor.GetLatestLeague(ctx)
		if err != nil {
			h.Respond(s, i, "❌ Failed to get latest league")
			log.Printf("Failed to get latest league: %v", err)
			return
		}
		year = league.Year
	}

	// NOTE: Discord command does NOT sync data - only uses existing data
	// Data sync is only done by the scheduled GitHub Actions job

	// Generate weekly summary using shared logic
	log.Printf("Generating weekly summary for year %d (Discord command)", year)
	summary, err := h.interactor.GenerateWeeklySummary(ctx, year)
	if err != nil {
		h.Respond(s, i, fmt.Sprintf("❌ Failed to generate weekly summary: %v", err))
		log.Printf("Failed to generate weekly summary: %v", err)
		return
	}

	// Get users for name lookup
	users, err := h.interactor.GetUsers(ctx)
	if err != nil {
		h.Respond(s, i, "❌ Failed to get users")
		log.Printf("Failed to get users: %v", err)
		return
	}

	// Use shared formatting logic
	response := format.WeeklySummary(summary, users)

	// Send the response
	h.Respond(s, i, response)
	log.Printf("Successfully sent weekly summary for year %d, week %d", summary.Year, summary.Week)
}
