package main

import (
	"any-given-sunday/internal/interactor"
	"any-given-sunday/pkg/client/sleeper"
	"context"
	"fmt"
	"log"
	"net/http"

	"github.com/joho/godotenv"
)

// The purpose of this application is to print a report of the highest score each completed week of the season.

func main() {
	err := godotenv.Load()
	if err != nil {
		log.Fatalf("error loading env: %v", err)
	}

	sc := sleeper.NewSleeperClient(http.DefaultClient)

	i := interactor.NewInteractor(sc)

	ctx := context.Background()

	state, err := i.SleeperClient.GetNFLState(ctx)
	if err != nil {
		log.Fatalf("error getting nfl state: %v", err)
	}

	for wk := 1; wk < state.Week; wk++ {
		s, err := i.HighestScoreForWeek(ctx, wk)
		if err != nil {
			log.Fatalf("error getting highest score for week %d: %v", wk, err)
		}
		fmt.Println(s)
	}
}
