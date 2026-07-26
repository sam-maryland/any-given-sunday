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
	sleeperClient       sleeper.ISleeperClient
}

// weeklyRecapConfig holds the environment-derived configuration for the weekly
// recap application. Only DatabaseURL is required; the Discord and email
// settings are optional and disable their respective notifications when unset.
type weeklyRecapConfig struct {
	DatabaseURL          string
	DiscordToken         string
	WeeklyRecapChannelID string
	ResendAPIKey         string
	FromEmail            string
}

// loadWeeklyRecapConfig reads the weekly recap configuration from the
// environment. It performs no I/O and returns an error only when a required
// variable is missing.
func loadWeeklyRecapConfig() (weeklyRecapConfig, error) {
	cfg := weeklyRecapConfig{
		DatabaseURL: os.Getenv("DATABASE_URL"),

		// Discord configuration (optional - if not set, Discord messages won't be sent)
		DiscordToken:         os.Getenv("DISCORD_TOKEN"),
		WeeklyRecapChannelID: os.Getenv("DISCORD_WEEKLY_RECAP_CHANNEL_ID"),

		// Email configuration (optional - if not set, emails won't be sent)
		ResendAPIKey: os.Getenv("RESEND_API_KEY"),
		FromEmail:    os.Getenv("FROM_EMAIL"),
	}

	if cfg.DatabaseURL == "" {
		return weeklyRecapConfig{}, fmt.Errorf("DATABASE_URL environment variable is required")
	}

	return cfg, nil
}

// connectPolicy controls the database connection retry loop.
type connectPolicy struct {
	// MaxAttempts is the total number of connection attempts, including the first.
	MaxAttempts int
	// BackoffUnit is multiplied by the attempt number to determine how long to
	// wait before the next attempt.
	BackoffUnit time.Duration
}

// defaultConnectPolicy retries three times with a 2s/4s backoff.
var defaultConnectPolicy = connectPolicy{MaxAttempts: 3, BackoffUnit: 2 * time.Second}

// connectDB opens a connection pool, retrying transient failures according to
// policy. A malformed DATABASE_URL fails immediately, since retrying cannot fix it.
func connectDB(ctx context.Context, databaseURL string, policy connectPolicy) (*pgxpool.Pool, error) {
	// Validate up front so a malformed URL fails immediately instead of
	// consuming the retry budget. pgxpool.New parses again per attempt, which
	// keeps each pool owner of its own config.
	if _, err := pgxpool.ParseConfig(databaseURL); err != nil {
		return nil, fmt.Errorf("failed to connect to database: invalid DATABASE_URL: %w", err)
	}

	var err error
	for attempt := 1; attempt <= policy.MaxAttempts; attempt++ {
		var pool *pgxpool.Pool
		pool, err = pgxpool.New(ctx, databaseURL)
		if err == nil {
			// Test database connection
			if pingErr := pool.Ping(ctx); pingErr == nil {
				return pool, nil // Success
			} else {
				pool.Close() // Close failed connection
				err = pingErr
			}
		}

		if attempt < policy.MaxAttempts {
			waitTime := time.Duration(attempt) * policy.BackoffUnit
			log.Printf("Database connection attempt %d/%d failed, retrying in %v: %v",
				attempt, policy.MaxAttempts, waitTime, err)
			time.Sleep(waitTime)
		}
	}

	return nil, fmt.Errorf("failed to connect to database after %d attempts: %w", policy.MaxAttempts, err)
}

// NewWeeklyRecapApp creates a new weekly recap application with all dependencies
func NewWeeklyRecapApp() (*WeeklyRecapApp, error) {
	cfg, err := loadWeeklyRecapConfig()
	if err != nil {
		return nil, err
	}

	return newWeeklyRecapApp(cfg, defaultConnectPolicy)
}

// newWeeklyRecapApp builds the application from an already-loaded config,
// using policy for the database connection retry loop.
func newWeeklyRecapApp(cfg weeklyRecapConfig, policy connectPolicy) (*WeeklyRecapApp, error) {
	// Initialize database connection with retry logic
	pool, err := connectDB(context.Background(), cfg.DatabaseURL, policy)
	if err != nil {
		return nil, err
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

	// Initialize Discord channel poster (optional)
	var channelPoster *discord.ChannelPoster
	if cfg.DiscordToken != "" && cfg.WeeklyRecapChannelID != "" {
		session, err := discordgo.New("Bot " + cfg.DiscordToken)
		if err != nil {
			log.Printf("Warning: Failed to create Discord session: %v", err)
			log.Println("Weekly recap will continue without Discord notifications")
		} else {
			channelPoster = discord.NewChannelPoster(session, cfg.WeeklyRecapChannelID)
			log.Println("✅ Discord client initialized successfully")
		}
	} else {
		log.Println("Discord configuration not found (DISCORD_TOKEN or DISCORD_WEEKLY_RECAP_CHANNEL_ID missing)")
		log.Println("Weekly recap will run without Discord notifications")
	}

	// Initialize email client (optional)
	var emailClient *email.Client
	if cfg.ResendAPIKey != "" && cfg.FromEmail != "" {
		emailClient, err = email.NewClient(cfg.ResendAPIKey, cfg.FromEmail)
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
		sleeperClient:       sleeperClient,
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

	// 2. Generate weekly summary message
	message, err := a.GenerateWeeklySummaryMessage(ctx, league.Year)
	if err != nil {
		return fmt.Errorf("failed to generate weekly summary message: %w", err)
	}

	// 3. Post to Discord channel (optional, won't fail the job if it errors)
	if a.channelPoster != nil {
		log.Println("Posting weekly summary to Discord...")
		if err := a.channelPoster.PostWeeklySummary(ctx, message); err != nil {
			log.Printf("⚠️  Failed to post weekly summary to Discord: %v", err)
			log.Println("Skipping Discord notification, but job continues")
		} else {
			log.Printf("✅ Weekly summary posted to Discord")
		}
	} else {
		log.Println("Discord client not configured, skipping Discord notification")
	}

	// 4. Send email notifications (optional, won't fail the job if it errors)
	if a.emailClient != nil {
		log.Println("Sending weekly recap emails...")

		// Get the summary data again for email
		summary, err := a.weeklyJobInteractor.GenerateWeeklySummary(ctx, league.Year)
		if err != nil {
			log.Printf("⚠️  Failed to generate summary for emails: %v", err)
			log.Println("Skipping email notifications")
		} else {
			// Get users with email addresses (for sending)
			dbUsersWithEmail, err := a.queries.GetUsersWithEmail(ctx)
			if err != nil {
				log.Printf("⚠️  Failed to get users with email addresses: %v", err)
				log.Println("Skipping email notifications")
			} else {
				// Fetch team names from Sleeper API
				sleeperUsers, err := a.sleeperClient.GetUsersInLeague(ctx, league.ID)
				if err != nil {
					log.Printf("⚠️  Failed to fetch Sleeper users for team names: %v", err)
					log.Println("Skipping email notifications")
				} else {
					// Create a map of UserID -> Team Name from Sleeper
					teamNames := make(domain.UserMap)
					for _, sleeperUser := range sleeperUsers {
						teamNames[sleeperUser.ID] = domain.User{
							ID:   sleeperUser.ID,
							Name: sleeperUser.TeamName(), // Use Sleeper team name
						}
					}

					// Convert recipients to domain users
					usersWithEmail := converters.UsersFromDB(dbUsersWithEmail)

					// Send emails (with recipients and team names for display)
					if err := a.emailClient.SendWeeklyRecap(ctx, summary, usersWithEmail, teamNames); err != nil {
						log.Printf("⚠️  Email sending encountered errors: %v", err)
						log.Println("Some or all emails may have failed, but job continues")
					} else {
						log.Printf("✅ Weekly recap emails sent successfully")
					}
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
