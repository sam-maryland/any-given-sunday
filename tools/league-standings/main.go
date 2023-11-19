package main

import (
	"any-given-sunday/internal/interactor"
	"any-given-sunday/pkg/client/sleeper"
	"context"
	"fmt"
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

	leagueID := os.Getenv("SLEEPER_LEAGUE_ID")

	league, err := i.SleeperClient.GetLeague(ctx, leagueID)
	if err != nil {
		log.Fatalf("error getting league: %v", err)
	}

	users, err := i.SleeperClient.GetUsersInLeague(ctx, leagueID)
	if err != nil {
		log.Fatalf("error getting users in league: %v", err)
	}

	rosters, err := i.GetLeagueStandings(ctx)
	if err != nil {
		log.Fatalf("error getting league standings: %v", err)
	}

	for i, r := range rosters {
		if i == league.Settings.PlayoffTeams {
			fmt.Println("------------- PLAYOFFS -------------")
		}
		fmt.Printf("%s (%d-%d-%d) %f\n", users.WithID(r.OwnerID).TeamName(), r.Settings.Wins, r.Settings.Losses, r.Settings.Ties, r.GetPointsFor())
	}
}
