package discord

import (
	"context"
	"fmt"
	"log"

	"github.com/bwmarrin/discordgo"
	"github.com/sam-maryland/any-given-sunday/internal/interactor"
	"github.com/sam-maryland/any-given-sunday/pkg/types/domain"
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

	// Sync latest data first
	log.Printf("Syncing latest data for year %d", year)
	if err := h.interactor.SyncLatestData(ctx, year); err != nil {
		h.Respond(s, i, "⚠️ Warning: Failed to sync latest data from Sleeper API. Proceeding with existing data.")
		log.Printf("Failed to sync latest data: %v", err)
	}

	// Generate weekly summary
	log.Printf("Generating weekly summary for year %d", year)
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

	// Format the response message
	response := h.formatWeeklySummary(summary, users)

	// Send the response
	h.Respond(s, i, response)
	log.Printf("Successfully sent weekly summary for year %d, week %d", summary.Year, summary.Week)
}

// formatWeeklySummary formats the weekly summary for Discord
func (h *Handler) formatWeeklySummary(summary *interactor.WeeklySummary, users domain.UserMap) string {
	var response string

	// Header
	response += fmt.Sprintf("📊 **Week %d Summary (%d)** 📊\n\n", summary.Week, summary.Year)

	// High Score Winner
	if summary.HighScore != nil {
		response += fmt.Sprintf("🏆 **High Score Winner**: %s - %.2f points\n",
			summary.HighScore.UserName, summary.HighScore.Score)
	} else {
		response += "❌ No high score data available for this week\n\n"
	}

	// Updated Standings
	response += "📈 **Current Standings:**\n"
	for i, standing := range summary.Standings {
		user, exists := users[standing.UserID]
		name := standing.UserID // Fallback if no name
		if exists {
			name = user.Name
		}
		// Format: "1. Team Name (10-3)"
		record := fmt.Sprintf("(%d-%d)", standing.Wins, standing.Losses)
		response += fmt.Sprintf("%d. %s %s\n", i+1, name, record)
	}
	response += "\n"

	return response
}
