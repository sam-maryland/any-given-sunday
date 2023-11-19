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

// The purpose of this application is to fetch and refresh the local storage of all player data.

func main() {
	err := godotenv.Load()
	if err != nil {
		log.Fatalf("error loading env: %v", err)
	}

	sc := sleeper.NewSleeperClient(http.DefaultClient)

	i := interactor.NewInteractor(sc)

	ctx := context.Background()

	pd, err := i.SleeperClient.FetchAllPlayers(ctx)
	if err != nil {
		log.Fatalf("error getting player data: %v", err)
	}

	f, err := os.OpenFile("./pkg/data/playerdata.json", os.O_WRONLY|os.O_CREATE, 0666)
	if err != nil {
		log.Fatalf("error creating or opening player data file: %v", err)
	}
	defer f.Close()

	if _, err := f.Write(pd); err != nil {
		log.Fatalf("error writing data to file: %v", err)
	}
}
