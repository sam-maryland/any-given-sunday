package interactor

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/sam-maryland/any-given-sunday/pkg/client/sleeper"
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
	// Fetch matchups from Sleeper API
	sleeperMatchups, err := i.SleeperClient.GetMatchupsForWeek(ctx, leagueID, week)
	if err != nil {
		return fmt.Errorf("failed to fetch matchups from Sleeper for week %d: %w", week, err)
	}

	// Get rosters to map RosterID -> OwnerID
	rosters, err := i.SleeperClient.GetRostersInLeague(ctx, leagueID)
	if err != nil {
		return fmt.Errorf("failed to fetch rosters from Sleeper: %w", err)
	}

	// Create roster ID to owner ID mapping
	rosterToOwner := make(map[int]string)
	for _, roster := range rosters {
		rosterToOwner[roster.ID] = roster.OwnerID
	}

	// Convert sleeper matchups to domain matchups
	domainMatchups, err := i.convertSleeperMatchupsToDomain(sleeperMatchups, rosterToOwner)
	if err != nil {
		return fmt.Errorf("failed to convert sleeper matchups to domain: %w", err)
	}

	// Process each domain matchup
	for _, matchup := range domainMatchups {
		err := i.upsertMatchup(ctx, matchup, year, week)
		if err != nil {
			return fmt.Errorf("failed to upsert matchup: %w", err)
		}
	}

	return nil
}

// convertSleeperMatchupsToDomain converts sleeper API matchups to domain matchups
// Sleeper returns individual team data per matchup, we need to group them into head-to-head games
func (i *interactor) convertSleeperMatchupsToDomain(sleeperMatchups sleeper.Matchups, rosterToOwner map[int]string) ([]domain.Matchup, error) {
	// Group matchups by MatchupID
	matchupGroups := make(map[int][]sleeper.Matchup)
	for _, sm := range sleeperMatchups {
		// Skip bye weeks (matchup_id is null/0)
		if sm.MatchupID == 0 {
			continue
		}
		matchupGroups[sm.MatchupID] = append(matchupGroups[sm.MatchupID], sm)
	}

	var domainMatchups []domain.Matchup
	for matchupID, matchups := range matchupGroups {
		// Each matchup should have exactly 2 teams
		if len(matchups) != 2 {
			return nil, fmt.Errorf("expected 2 teams for matchup %d, got %d", matchupID, len(matchups))
		}

		// Get owner IDs for both teams
		team1 := matchups[0]
		team2 := matchups[1]

		owner1, ok := rosterToOwner[team1.RosterID]
		if !ok {
			return nil, fmt.Errorf("roster %d not found in roster mapping", team1.RosterID)
		}

		owner2, ok := rosterToOwner[team2.RosterID]
		if !ok {
			return nil, fmt.Errorf("roster %d not found in roster mapping", team2.RosterID)
		}

		// Create domain matchup (team1 = home, team2 = away by convention)
		domainMatchup := domain.Matchup{
			ID:         fmt.Sprintf("%d", matchupID), // Use matchup ID as string ID
			HomeUserID: owner1,
			AwayUserID: owner2,
			HomeScore:  team1.Points,
			AwayScore:  team2.Points,
			IsPlayoff:  false, // We'll determine playoff status elsewhere if needed
		}

		domainMatchups = append(domainMatchups, domainMatchup)
	}

	return domainMatchups, nil
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
				String: func() string {
					if matchup.PlayoffRound != nil {
						return *matchup.PlayoffRound
					}
					return ""
				}(),
				Valid: matchup.PlayoffRound != nil && *matchup.PlayoffRound != "",
			},
			HomeUserID: matchup.HomeUserID,
			AwayUserID: matchup.AwayUserID,
			HomeSeed: pgtype.Int4{
				Int32: func() int32 {
					if matchup.HomeSeed != nil {
						return int32(*matchup.HomeSeed)
					}
					return 0
				}(),
				Valid: matchup.HomeSeed != nil && *matchup.HomeSeed > 0,
			},
			AwaySeed: pgtype.Int4{
				Int32: func() int32 {
					if matchup.AwaySeed != nil {
						return int32(*matchup.AwaySeed)
					}
					return 0
				}(),
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
		DataSyncStatus: i.calculateDataSyncStatus(ctx, year, int(latestWeek)),
	}, nil
}

// calculateDataSyncStatus determines the current sync status between local data and Sleeper API
func (i *interactor) calculateDataSyncStatus(ctx context.Context, year, latestWeek int) string {
	// Get current NFL state to check the actual current week
	nflState, err := i.SleeperClient.GetNFLState(ctx)
	if err != nil {
		return "⚠️ Unable to verify sync status"
	}
	
	// If our latest week matches or exceeds the current NFL week, we're current
	if latestWeek >= nflState.Week {
		return "✅ Current"
	}
	
	// Calculate how many weeks behind we are
	weeksBehind := nflState.Week - latestWeek
	if weeksBehind == 1 {
		return "⏳ 1 week behind"
	}
	
	return fmt.Sprintf("⚠️ %d weeks behind", weeksBehind)
}
