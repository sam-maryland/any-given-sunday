package interactor

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/sam-maryland/any-given-sunday/pkg/db"
	"github.com/sam-maryland/any-given-sunday/pkg/types/domain"
)

type WeeklyJobInteractor interface {
	SyncLatestData(ctx context.Context, year int) error
	GetWeeklyHighScore(ctx context.Context, year, week int) (*WeeklyHighScore, error)
	GenerateWeeklySummary(ctx context.Context, year int) (*WeeklySummary, error)
}

type WeeklyHighScore struct {
	UserID     string
	UserName   string
	Score      float64
	Week       int
	Year       int
	PaymentDue float64 // Always $15 for regular season
}

type WeeklySummary struct {
	Year           int
	Week           int
	HighScore      *WeeklyHighScore
	Standings      domain.Standings
	DataSyncStatus string
}

// SyncLatestData fetches and updates the latest matchup data from Sleeper API
func (i *interactor) SyncLatestData(ctx context.Context, year int) error {
	// Get the current league for the year
	league, err := i.GetLeagueByYear(ctx, year)
	if err != nil {
		return fmt.Errorf("failed to get league for year %d: %w", year, err)
	}

	// Get current NFL state to determine the latest week
	nflState, err := i.SleeperClient.GetNFLState(ctx)
	if err != nil {
		return fmt.Errorf("failed to get NFL state: %w", err)
	}

	// Sync data for each week up to the current week
	for week := 1; week <= nflState.Week; week++ {
		err := i.syncWeekData(ctx, league.ID, year, week)
		if err != nil {
			// Log error but continue with other weeks
			fmt.Printf("Failed to sync week %d: %v\n", week, err)
		}
	}

	return nil
}

// syncWeekData syncs matchup data for a specific week
func (i *interactor) syncWeekData(ctx context.Context, leagueID string, year, week int) error {
	// TODO: Fix this function after type consolidation
	// Need to convert sleeper.Matchup (individual roster data) to domain.Matchup (head-to-head matchups)
	// This requires grouping sleeper matchups by MatchupID and constructing complete matchups
	return fmt.Errorf("syncWeekData needs to be reimplemented after type consolidation")
}

// upsertMatchup inserts or updates a single matchup
func (i *interactor) upsertMatchup(ctx context.Context, matchup domain.Matchup, year, week int) error {
	// Check if the matchup already exists
	existing, err := i.DB.GetMatchupByYearWeekUsers(ctx, db.GetMatchupByYearWeekUsersParams{
		Year:       int32(year),
		Week:       int32(week),
		HomeUserID: matchup.HomeUserID,
		AwayUserID: matchup.AwayUserID,
	})

	if err != nil {
		// Matchup doesn't exist, insert it
		_, err = i.DB.InsertMatchup(ctx, db.InsertMatchupParams{
			Year:      int32(year),
			Week:      int32(week),
			IsPlayoff: pgtype.Bool{Bool: matchup.IsPlayoff, Valid: true},
			PlayoffRound: pgtype.Text{
				String: func() string { if matchup.PlayoffRound != nil { return *matchup.PlayoffRound }; return "" }(),
				Valid:  matchup.PlayoffRound != nil && *matchup.PlayoffRound != "",
			},
			HomeUserID: matchup.HomeUserID,
			AwayUserID: matchup.AwayUserID,
			HomeSeed: pgtype.Int4{
				Int32: func() int32 { if matchup.HomeSeed != nil { return int32(*matchup.HomeSeed) }; return 0 }(),
				Valid: matchup.HomeSeed != nil && *matchup.HomeSeed > 0,
			},
			AwaySeed: pgtype.Int4{
				Int32: func() int32 { if matchup.AwaySeed != nil { return int32(*matchup.AwaySeed) }; return 0 }(),
				Valid: matchup.AwaySeed != nil && *matchup.AwaySeed > 0,
			},
			HomeScore: matchup.HomeScore,
			AwayScore: matchup.AwayScore,
		})
		if err != nil {
			return fmt.Errorf("failed to insert matchup: %w", err)
		}
	} else {
		// Matchup exists, update scores if they've changed
		if existing.HomeScore != matchup.HomeScore || existing.AwayScore != matchup.AwayScore {
			err = i.DB.UpdateMatchupScores(ctx, db.UpdateMatchupScoresParams{
				Year:       int32(year),
				Week:       int32(week),
				HomeScore:  matchup.HomeScore,
				AwayScore:  matchup.AwayScore,
				HomeUserID: matchup.HomeUserID,
				AwayUserID: matchup.AwayUserID,
			})
			if err != nil {
				return fmt.Errorf("failed to update matchup scores: %w", err)
			}
		}
	}

	return nil
}

// GetWeeklyHighScore retrieves the highest scoring team for a specific week
func (i *interactor) GetWeeklyHighScore(ctx context.Context, year, week int) (*WeeklyHighScore, error) {
	// Query the database for the highest score in the specified week
	params := db.GetWeeklyHighScoreParams{
		Year: int32(year),
		Week: int32(week),
	}

	result, err := i.DB.GetWeeklyHighScore(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("failed to get weekly high score: %w", err)
	}

	// Get the user's name from the users table
	user, err := i.DB.GetUserByID(ctx, result.WinnerUserID)
	if err != nil {
		return nil, fmt.Errorf("failed to get user details: %w", err)
	}

	return &WeeklyHighScore{
		UserID:     result.WinnerUserID,
		UserName:   user.Name,
		Score:      result.WinningScore,
		Week:       int(result.Week),
		Year:       int(result.Year),
		PaymentDue: 15.00, // $15 for regular season high score
	}, nil
}

// GenerateWeeklySummary creates a comprehensive weekly summary
func (i *interactor) GenerateWeeklySummary(ctx context.Context, year int) (*WeeklySummary, error) {
	// Get the latest completed week
	latestWeek, err := i.DB.GetLatestCompletedWeek(ctx, int32(year))
	if err != nil {
		return nil, fmt.Errorf("failed to get latest completed week: %w", err)
	}

	if latestWeek == 0 {
		return nil, fmt.Errorf("no completed weeks found for year %d", year)
	}

	// Get the high score for the latest completed week
	highScore, err := i.GetWeeklyHighScore(ctx, year, int(latestWeek))
	if err != nil {
		return nil, fmt.Errorf("failed to get weekly high score: %w", err)
	}

	// Get the current league
	league, err := i.GetLeagueByYear(ctx, year)
	if err != nil {
		return nil, fmt.Errorf("failed to get league: %w", err)
	}

	// Calculate current standings
	standings, err := i.GetStandingsForLeague(ctx, league)
	if err != nil {
		return nil, fmt.Errorf("failed to get standings: %w", err)
	}

	return &WeeklySummary{
		Year:           year,
		Week:           int(latestWeek),
		HighScore:      highScore,
		Standings:      standings,
		DataSyncStatus: "✅ Current", // TODO: Update based on actual sync status
	}, nil
}
