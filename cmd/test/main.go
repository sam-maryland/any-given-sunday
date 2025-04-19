package main

import (
	"any-given-sunday/internal/dependency"
	"any-given-sunday/internal/interactor"
	"any-given-sunday/pkg/config"
	"context"
	"fmt"
)

func main() {
	ctx := context.Background()
	cfg := config.InitConfig()
	c := dependency.NewDependencyChain(ctx, cfg)

	i := interactor.NewInteractor(c)

	standings, err := i.GetStandingsForYear(ctx, 2026)
	if err != nil {
		panic(err)
	}

	for _, s := range standings {
		u, err := i.SleeperClient.GetUser(ctx, s.UserID)
		if err != nil {
			panic(err)
		}
		fmt.Printf("%s: %d-%d-%d, PF: %.02f, PA: %.02f\n", u.TeamName(), s.Wins, s.Losses, s.Ties, s.PointsFor, s.PointsAgainst)
	}
}
