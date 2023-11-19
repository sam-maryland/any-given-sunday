package main

import (
	"any-given-sunday/internal/interactor"
	"any-given-sunday/pkg/client/sleeper"
	"context"
	"log"
	"net/http"
	"os"

	"github.com/joho/godotenv"
)

func main() {
	err := godotenv.Load()
	if err != nil {
		log.Fatalf("error loading env: %v", err)
	}

	sc := sleeper.NewSleeperClient(http.DefaultClient)

	i := interactor.NewInteractor(sc)

	ctx := context.Background()

	rosters, err := i.SleeperClient.GetRostersInLeague(ctx, os.Getenv("SLEEPER_LEAGUE_ID"))
	if err != nil {
		log.Fatalf("error getting rosters: %v", err)
	}

	users, err := i.SleeperClient.GetUsersInLeague(ctx, os.Getenv("SLEEPER_LEAGUE_ID"))
	if err != nil {
		log.Fatalf("error getting teams: %v", err)
	}

	p, err := i.LoadAllPlayers(ctx)
	if err != nil {
		log.Fatalf("error loading player data: %v", err)
	}

	for _, r := range rosters {
		user := users.WithID(r.OwnerID)
		user.String()
		for _, s := range r.Starters {
			p[s].String()
		}
		println()
	}
}
