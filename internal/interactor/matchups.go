package interactor

import (
	"context"
	"fmt"
	"os"
)

type ReportInteractor interface {
	HighestScoreForWeek(ctx context.Context, week int) (string, error)
}

func (i *interactor) HighestScoreForWeek(ctx context.Context, week int) (string, error) {
	leagueID := os.Getenv("SLEEPER_LEAGUE_ID")

	rosters, err := i.SleeperClient.GetRostersInLeague(ctx, leagueID)
	if err != nil {
		return "", err
	}

	matchups, err := i.SleeperClient.GetMatchupsForWeek(ctx, leagueID, week)
	if err != nil {
		return "", err
	}

	highMatchup := matchups.WithMaxPoints()

	highRoster := rosters.WithID(highMatchup.RosterID)

	user, err := i.SleeperClient.GetUser(ctx, highRoster.OwnerID)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("Week %d - %s (%f)", week, user.DisplayName, highMatchup.Points), nil
}
