package email

import (
	"fmt"
	"strings"

	"github.com/sam-maryland/any-given-sunday/internal/interactor"
	"github.com/sam-maryland/any-given-sunday/pkg/types/domain"
)

// GenerateWeeklyRecapHTML creates a beautiful, mobile-first HTML email for the weekly recap
func GenerateWeeklyRecapHTML(summary *interactor.WeeklySummary, users domain.UserMap) string {
	var html strings.Builder

	// Email container with mobile-first styling
	html.WriteString(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Weekly Fantasy Recap</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f4f4f4;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f4f4f4;">
        <tr>
            <td align="center" style="padding: 20px 0;">
                <!-- Main Container -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
`)

	// Header Section
	html.WriteString(fmt.Sprintf(`
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #0a3d0c 0%%, #1a5d1a 100%%); padding: 30px 20px; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">🏈 WEEKLY RECAP 🏈</h1>
                            <p style="color: #e0e0e0; margin: 10px 0 0 0; font-size: 18px;">Week %d • %d</p>
                        </td>
                    </tr>
`, summary.Week, summary.Year))

	// High Score Winner Section
	if summary.HighScore != nil {
		html.WriteString(fmt.Sprintf(`
                    <!-- High Score Winner -->
                    <tr>
                        <td style="background-color: #ffd700; padding: 30px 20px; text-align: center; border-bottom: 4px solid #f0c000;">
                            <p style="color: #333; margin: 0 0 10px 0; font-size: 16px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">💰 High Score Winner 💰</p>
                            <h2 style="color: #000; margin: 10px 0; font-size: 32px; font-weight: bold;">%s</h2>
                            <p style="color: #333; margin: 10px 0 0 0; font-size: 24px; font-weight: bold;">%.2f points</p>
                            <p style="color: #555; margin: 15px 0 0 0; font-size: 16px;">Earned the $15 bonus!</p>
                        </td>
                    </tr>
`, summary.HighScore.UserName, summary.HighScore.Score))
	} else {
		html.WriteString(`
                    <!-- No High Score Available -->
                    <tr>
                        <td style="background-color: #f0f0f0; padding: 30px 20px; text-align: center; border-bottom: 2px solid #ddd;">
                            <p style="color: #666; margin: 0; font-size: 16px;">❌ No high score data available for this week</p>
                        </td>
                    </tr>
`)
	}

	// Standings Section
	html.WriteString(`
                    <!-- Standings -->
                    <tr>
                        <td style="padding: 30px 20px;">
                            <h3 style="color: #0a3d0c; margin: 0 0 20px 0; font-size: 20px; text-align: center; font-weight: bold;">📊 STANDINGS 📊</h3>
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
`)

	// Generate standings rows
	for i, standing := range summary.Standings {
		user, exists := users[standing.UserID]
		name := standing.UserID
		if exists {
			name = user.Name
		}

		// Medal for top 3
		medal := ""
		switch i {
		case 0:
			medal = " 🥇"
		case 1:
			medal = " 🥈"
		case 2:
			medal = " 🥉"
		}

		// Alternating row colors for readability
		bgColor := "#ffffff"
		if i%2 == 1 {
			bgColor = "#f9f9f9"
		}

		html.WriteString(fmt.Sprintf(`
                                <tr>
                                    <td style="padding: 12px 15px; background-color: %s; border-bottom: 1px solid #e0e0e0;">
                                        <span style="color: #333; font-size: 16px; font-weight: %s;">%d. %s <span style="color: #666;">(%d-%d)</span>%s</span>
                                    </td>
                                </tr>
`, bgColor, getBoldWeight(i), i+1, name, standing.Wins, standing.Losses, medal))
	}

	html.WriteString(`
                            </table>
                        </td>
                    </tr>
`)

	// Footer Section
	html.WriteString(fmt.Sprintf(`
                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f8f8f8; padding: 25px 20px; text-align: center; border-top: 2px solid #e0e0e0;">
                            <p style="color: #555; margin: 0 0 15px 0; font-size: 14px;">Next update after Week %d games complete! 🏈</p>
                            <a href="https://sleeper.com" style="display: inline-block; background-color: #0a3d0c; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-size: 14px; font-weight: bold;">View on Sleeper →</a>
                        </td>
                    </tr>
`, summary.Week+1))

	// Close HTML
	html.WriteString(`
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`)

	return html.String()
}

// getBoldWeight returns bold for top 3, normal for others
func getBoldWeight(position int) string {
	if position < 3 {
		return "bold"
	}
	return "normal"
}
