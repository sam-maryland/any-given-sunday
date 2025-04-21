package dependency

import (
	"context"
	"log"
	"net/http"

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

func NewDependencyChain(ctx context.Context, cfg *config.Config) *Chain {
	pool, err := pgxpool.New(ctx, cfg.DBUrl)
	if err != nil {
		log.Fatalf("failed to connect to db: %v", err)
	}
	q := db.New(pool)

	sleeperClient := sleeper.NewSleeperClient(http.DefaultClient)

	dg, err := discordgo.New("Bot " + cfg.Token)
	if err != nil {
		log.Fatal("error creating Discord session:", err)
	}

	// Open a connection to Discord
	if err := dg.Open(); err != nil {
		log.Fatal("Error opening connection to Discord:", err)
	}

	return &Chain{
		DB:            q,
		Pool:          pool,
		SleeperClient: sleeperClient,
		Discord:       dg,
	}
}
