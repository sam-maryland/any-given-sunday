package main

import (
	"any-given-sunday/internal/interactor"
	"any-given-sunday/pkg/client/discord"
	"any-given-sunday/pkg/client/sleeper"
	"context"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/joho/godotenv"
)

// The purpose of this application is to send a weekly reminder to the Commissioner to pay out the weekly highest scorer.

func main() {
	_ = godotenv.Load()

	sc := sleeper.NewSleeperClient(http.DefaultClient)

	dc := discord.NewDiscordClient(os.Getenv("DISCORD_BOT_TOKEN"), os.Getenv("DISCORD_USER_ID"))

	i := interactor.NewInteractor(sc)

	ctx := context.Background()

	state, err := i.SleeperClient.GetNFLState(ctx)
	if err != nil {
		log.Fatalf("error getting nfl state: %v", err)
	}

	h, err := i.HighestScoreForWeek(ctx, state.Leg-1)
	if err != nil {
		log.Fatalf("error getting high score for previous week: %v", err)
	}

	h = fmt.Sprintf("High Score Notification for %s", h)

	if err := dc.SendMessage(ctx, h); err != nil {
		log.Fatalf("error sending message: %v", err)
	}
}
