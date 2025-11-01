package app

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sam-maryland/any-given-sunday/internal/dependency"
	"github.com/sam-maryland/any-given-sunday/internal/discord"
	"github.com/sam-maryland/any-given-sunday/internal/email"
	"github.com/sam-maryland/any-given-sunday/internal/format"
	"github.com/sam-maryland/any-given-sunday/internal/interactor"
	"github.com/sam-maryland/any-given-sunday/pkg/client/sleeper"
	"github.com/sam-maryland/any-given-sunday/pkg/db"
	"github.com/sam-maryland/any-given-sunday/pkg/types/converters"
	"github.com/sam-maryland/any-given-sunday/pkg/types/domain"
)

// WeeklyRecapApp orchestrates the automated weekly recap functionality
type WeeklyRecapApp struct {
	weeklyJobInteractor interactor.WeeklyJobInteractor
	channelPoster       *discord.ChannelPoster
	interactor          interactor.Interactor
	emailClient         *email.Client
	queries             *db.Queries
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

	// Email configuration (optional - if not set, emails won't be sent)
	resendAPIKey := os.Getenv("RESEND_API_KEY")
	fromEmail := os.Getenv("FROM_EMAIL")

	// Initialize database connection with retry logic
	var pool *pgxpool.Pool
	var err error
	maxRetries := 3

	for attempt := 1; attempt <= maxRetries; attempt++ {
		pool, err = pgxpool.New(context.Background(), databaseURL)
		if err == nil {
			// Test database connection
			if pingErr := pool.Ping(context.Background()); pingErr == nil {
				break // Success
			} else {
				pool.Close() // Close failed connection
				err = pingErr
			}
		}

		if attempt < maxRetries {
			waitTime := time.Duration(attempt*2) * time.Second
			log.Printf("Database connection attempt %d/%d failed, retrying in %v: %v",
				attempt, maxRetries, waitTime, err)
			time.Sleep(waitTime)
		}
	}

	if err != nil {
		return nil, fmt.Errorf("failed to connect to database after %d attempts: %w", maxRetries, err)
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

	// Initialize email client (optional)
	var emailClient *email.Client
	if resendAPIKey != "" && fromEmail != "" {
		emailClient, err = email.NewClient(resendAPIKey, fromEmail)
		if err != nil {
			log.Printf("Warning: Failed to initialize email client: %v", err)
			log.Println("Weekly recap will continue without email notifications")
		} else {
			log.Println("✅ Email client initialized successfully")
		}
	} else {
		log.Println("Email configuration not found (RESEND_API_KEY or FROM_EMAIL missing)")
		log.Println("Weekly recap will run without email notifications")
	}

	return &WeeklyRecapApp{
		weeklyJobInteractor: inter,
		channelPoster:       channelPoster,
		interactor:          inter,
		emailClient:         emailClient,
		queries:             queries,
	}, nil
}

// RunWeeklyRecap executes the complete weekly recap workflow for IN_PROGRESS leagues only
func (a *WeeklyRecapApp) RunWeeklyRecap(ctx context.Context) error {
	// Get the latest league
	league, err := a.interactor.GetLatestLeague(ctx)
	if err != nil {
		log.Printf("No league found, skipping weekly recap: %v", err)
		return nil
	}

	// Check if the league is IN_PROGRESS - only process active leagues
	if league.Status != domain.LeagueStatusInProgress {
		log.Printf("League year %d has status '%s' (not IN_PROGRESS), skipping weekly recap",
			league.Year, league.Status)
		return nil
	}

	log.Printf("Running weekly recap for IN_PROGRESS league year %d", league.Year)

	// 1. Sync latest data from Sleeper API
	log.Println("Syncing latest data from Sleeper API...")
	if err := a.weeklyJobInteractor.SyncLatestData(ctx, league.Year); err != nil {
		return fmt.Errorf("failed to sync data from Sleeper API: %w", err)
	}
	log.Println("✅ Data sync completed successfully")

	// 2. Generate and post weekly summary
	message, err := a.GenerateWeeklySummaryMessage(ctx, league.Year)
	if err != nil {
		return fmt.Errorf("failed to generate weekly summary message: %w", err)
	}

	// 3. Post to Discord channel
	log.Println("Posting weekly summary to Discord...")
	if err := a.channelPoster.PostWeeklySummary(ctx, message); err != nil {
		return fmt.Errorf("failed to post weekly summary to Discord: %w", err)
	}
	log.Printf("✅ Weekly summary posted to Discord")

	// 4. Send email notifications (optional, won't fail the job if it errors)
	if a.emailClient != nil {
		log.Println("Sending weekly recap emails...")

		// Get the summary data again for email
		summary, err := a.weeklyJobInteractor.GenerateWeeklySummary(ctx, league.Year)
		if err != nil {
			log.Printf("⚠️  Failed to generate summary for emails: %v", err)
			log.Println("Skipping email notifications")
		} else {
			// Get users with email addresses
			dbUsers, err := a.queries.GetUsersWithEmail(ctx)
			if err != nil {
				log.Printf("⚠️  Failed to get users with email addresses: %v", err)
				log.Println("Skipping email notifications")
			} else {
				// Convert db users to domain users
				users := converters.UsersFromDB(dbUsers)

				// Send emails
				if err := a.emailClient.SendWeeklyRecap(ctx, summary, users); err != nil {
					log.Printf("⚠️  Email sending encountered errors: %v", err)
					log.Println("Some or all emails may have failed, but job continues")
				} else {
					log.Printf("✅ Weekly recap emails sent successfully")
				}
			}
		}
	} else {
		log.Println("Email client not configured, skipping email notifications")
	}

	return nil
}

// GenerateWeeklySummaryMessage generates a formatted weekly summary message (shared logic)
func (a *WeeklyRecapApp) GenerateWeeklySummaryMessage(ctx context.Context, year int) (string, error) {
	// Generate weekly summary
	log.Printf("Generating weekly summary for year %d", year)
	summary, err := a.weeklyJobInteractor.GenerateWeeklySummary(ctx, year)
	if err != nil {
		return "", fmt.Errorf("failed to generate weekly summary: %w", err)
	}
	log.Printf("✅ Weekly summary generated for week %d", summary.Week)

	// Get users for name formatting
	users, err := a.interactor.GetUsers(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to get users: %w", err)
	}

	// Format the message using shared formatting logic
	return format.WeeklySummary(summary, users), nil
}
