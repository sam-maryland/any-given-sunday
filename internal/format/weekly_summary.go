package format

import (
	"fmt"
	"strings"

	"github.com/sam-maryland/any-given-sunday/internal/interactor"
	"github.com/sam-maryland/any-given-sunday/pkg/types/domain"
)

// StripMarkdown converts a Discord-formatted message to plain text suitable
// for pasting into an SMS/group chat.
func StripMarkdown(s string) string {
	return strings.ReplaceAll(s, "**", "")
}

// WeeklySummary formats the weekly summary for Discord (shared formatting logic)
func WeeklySummary(summary *interactor.WeeklySummary, users domain.UserMap) string {
	var response string

	// Header
	response += fmt.Sprintf("📊 **Week %d Summary (%d)** 📊\n\n", summary.Week, summary.Year)

	// High Score Winner
	if summary.HighScore != nil {
		response += fmt.Sprintf("🏆 **High Score Winner**: %s - %.2f points\n",
			summary.HighScore.UserName, summary.HighScore.Score)
		response += "💰 Congrats! You've earned the $15 weekly high score bonus!\n\n"
	} else {
		response += "❌ No high score data available for this week\n\n"
	}

	// Current Standings
	response += "📈 **Current Standings:**\n"
	for i, standing := range summary.Standings {
		user, exists := users[standing.UserID]
		name := standing.UserID // Fallback if no name
		if exists {
			name = user.Name
		}

		// Add medal emojis for top 3
		var medal string
		switch i {
		case 0:
			medal = " 🥇"
		case 1:
			medal = " 🥈"
		case 2:
			medal = " 🥉"
		default:
			medal = ""
		}

		// Format: "1. Team Name (10-3) 🥇"
		record := fmt.Sprintf("(%d-%d)", standing.Wins, standing.Losses)
		response += fmt.Sprintf("%d. %s %s%s\n", i+1, name, record, medal)
	}
	response += "\n"

	// Footer
	response += fmt.Sprintf("Next update after Week %d games complete! 🏈", summary.Week+1)

	return response
}
