package dependency

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/sam-maryland/any-given-sunday/pkg/client/sleeper"
	"github.com/sam-maryland/any-given-sunday/pkg/config"
	"github.com/sam-maryland/any-given-sunday/pkg/db"

	"github.com/bwmarrin/discordgo"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Chain struct {
	Pool          *pgxpool.Pool
	DB            *db.Queries
	SleeperClient *sleeper.SleeperClient
	Discord       *discordgo.Session
}

func NewDependencyChain(ctx context.Context, cfg *config.Config) (*Chain, error) {
	pool, err := pgxpool.New(ctx, cfg.DBUrl)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to db: %w", err)
	}
	q := db.New(pool)

	sleeperClient := sleeper.NewSleeperClient(http.DefaultClient)

	dg, err := discordgo.New("Bot " + cfg.Token)
	if err != nil {
		pool.Close()
		return nil, fmt.Errorf("error creating Discord session: %w", err)
	}

	// Set required intents for guild member events and message content
	dg.Identify.Intents = discordgo.IntentsGuildMembers | discordgo.IntentsGuilds | discordgo.IntentsGuildMessages

	// Add timeout configuration for HTTP client
	dg.Client.Timeout = 30 * time.Second

	// Open a connection to Discord with retry logic
	for attempt := 1; attempt <= 3; attempt++ {
		log.Printf("Attempting Discord connection (attempt %d/3)...", attempt)
		err = dg.Open()
		if err == nil {
			log.Printf("✅ Discord connection successful on attempt %d", attempt)
			break
		}

		log.Printf("Discord connection attempt %d failed: %v", attempt, err)
		if attempt < 3 {
			waitTime := time.Duration(attempt*2) * time.Second
			log.Printf("Retrying in %v...", waitTime)
			time.Sleep(waitTime)
		}
	}

	if err != nil {
		pool.Close()
		return nil, fmt.Errorf("failed to connect to Discord after 3 attempts: %w", err)
	}

	return &Chain{
		DB:            q,
		Pool:          pool,
		SleeperClient: sleeperClient,
		Discord:       dg,
	}, nil
}
