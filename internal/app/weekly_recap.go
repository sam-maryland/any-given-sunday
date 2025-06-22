package app

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/bwmarrin/discordgo"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sam-maryland/any-given-sunday/internal/dependency"
	"github.com/sam-maryland/any-given-sunday/internal/discord"
	"github.com/sam-maryland/any-given-sunday/internal/interactor"
	"github.com/sam-maryland/any-given-sunday/pkg/client/sleeper"
	"github.com/sam-maryland/any-given-sunday/pkg/db"
	"github.com/sam-maryland/any-given-sunday/pkg/types/domain"
)

// WeeklyRecapApp orchestrates the automated weekly recap functionality
type WeeklyRecapApp struct {
	weeklyJobInteractor interactor.WeeklyJobInteractor
	channelPoster       *discord.ChannelPoster
	interactor          interactor.Interactor
}

// NewWeeklyRecapApp creates a new weekly recap application with all dependencies
func NewWeeklyRecapApp() (*WeeklyRecapApp, error) {
	// Get required environment variables
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL environment variable is required")
	}

	discordToken := os.Getenv("DISCORD_TOKEN")
	if discordToken == "" {
		return nil, fmt.Errorf("DISCORD_TOKEN environment variable is required")
	}

	weeklyRecapChannelID := os.Getenv("DISCORD_WEEKLY_RECAP_CHANNEL_ID")
	if weeklyRecapChannelID == "" {
		return nil, fmt.Errorf("DISCORD_WEEKLY_RECAP_CHANNEL_ID environment variable is required")
	}

	// Initialize database connection
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to create database pool: %w", err)
	}

	// Test database connection
	if err := pool.Ping(context.Background()); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	// Initialize database queries
	queries := db.New(pool)

	// Initialize Sleeper client
	sleeperClient := sleeper.NewSleeperClient(http.DefaultClient)

	// Create dependency chain
	chain := &dependency.Chain{
		Pool:          pool,
		DB:            queries,
		SleeperClient: sleeperClient,
	}

	// Initialize interactor
	inter := interactor.NewInteractor(chain)

	// Initialize Discord session
	session, err := discordgo.New("Bot " + discordToken)
	if err != nil {
		return nil, fmt.Errorf("failed to create Discord session: %w", err)
	}

	// Initialize channel poster
	channelPoster := discord.NewChannelPoster(session, weeklyRecapChannelID)

	return &WeeklyRecapApp{
		weeklyJobInteractor: inter,
		channelPoster:       channelPoster,
		interactor:          inter,
	}, nil
}

// RunWeeklyRecap executes the complete weekly recap workflow
func (a *WeeklyRecapApp) RunWeeklyRecap(ctx context.Context) error {
	// Get the latest/active league
	league, err := a.interactor.GetLatestLeague(ctx)
	if err != nil {
		// If no active league, exit gracefully
		log.Printf("No active league found, skipping weekly recap: %v", err)
		return nil
	}

	log.Printf("Running weekly recap for league year %d", league.Year)

	// 1. Sync latest data from Sleeper API
	log.Println("Syncing latest data from Sleeper API...")
	if err := a.weeklyJobInteractor.SyncLatestData(ctx, league.Year); err != nil {
		return fmt.Errorf("failed to sync data from Sleeper API: %w", err)
	}
	log.Println("✅ Data sync completed successfully")

	// 2. Generate weekly summary
	log.Println("Generating weekly summary...")
	summary, err := a.weeklyJobInteractor.GenerateWeeklySummary(ctx, league.Year)
	if err != nil {
		return fmt.Errorf("failed to generate weekly summary: %w", err)
	}
	log.Printf("✅ Weekly summary generated for week %d", summary.Week)

	// 3. Get users for name formatting
	users, err := a.interactor.GetUsers(ctx)
	if err != nil {
		return fmt.Errorf("failed to get users: %w", err)
	}

	// 4. Format the Discord message
	message := a.formatWeeklySummary(summary, users)

	// 5. Post to Discord channel
	log.Println("Posting weekly summary to Discord...")
	if err := a.channelPoster.PostWeeklySummary(ctx, message); err != nil {
		return fmt.Errorf("failed to post weekly summary to Discord: %w", err)
	}
	log.Printf("✅ Weekly summary posted to Discord for week %d", summary.Week)

	return nil
}

// formatWeeklySummary formats the weekly summary for Discord (reuses existing logic)
func (a *WeeklyRecapApp) formatWeeklySummary(summary *interactor.WeeklySummary, users domain.UserMap) string {
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