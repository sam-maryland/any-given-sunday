package dependency

import (
	"any-given-sunday/pkg/client/sleeper"
	"any-given-sunday/pkg/config"
	"context"
	"log"
	"net/http"

	"github.com/bwmarrin/discordgo"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Chain struct {
	Pool          *pgxpool.Pool
	SleeperClient *sleeper.SleeperClient
	Discord       *discordgo.Session
}

func NewDependencyChain(ctx context.Context, cfg *config.Config) *Chain {
	pool, err := pgxpool.New(ctx, cfg.DBUrl)
	if err != nil {
		log.Fatalf("failed to connect to db: %v", err)
	}

	sleeperClient := sleeper.NewSleeperClient(http.DefaultClient)

	dg, err := discordgo.New("Bot " + cfg.Discord.Token)
	if err != nil {
		log.Fatal("error creating Discord session:", err)
	}

	return &Chain{
		Pool:          pool,
		SleeperClient: sleeperClient,
		Discord:       dg,
	}
}
