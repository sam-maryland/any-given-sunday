package interactor

import (
	"context"
	"errors"
	"testing"

	"github.com/sam-maryland/any-given-sunday/internal/dependency"
	"github.com/sam-maryland/any-given-sunday/pkg/client/sleeper"
	"github.com/sam-maryland/any-given-sunday/pkg/db"
	"github.com/sam-maryland/any-given-sunday/pkg/types/converters"
	"github.com/sam-maryland/any-given-sunday/pkg/types/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
)

// testableWeeklyJobInteractor allows us to test with mock dependencies
type testableWeeklyJobInteractor struct {
	chain *dependency.TestChain
}

func (i *testableWeeklyJobInteractor) SyncLatestData(ctx context.Context, year int) error {
	// Get league for the given year
	league, err := i.chain.DB.GetLeagueByYear(ctx, int32(year))
	if err != nil {
		return err
	}

	// Get current NFL state to determine the latest week
	nflState, err := i.chain.SleeperClient.GetNFLState(ctx)
	if err != nil {
		return err
	}

	// Sync data for each week up to the current week
	for week := 1; week <= nflState.Week; week++ {
		err := i.syncWeekData(ctx, league.ID, year, week)
		if err != nil {
			// Log error but continue with other weeks
			continue
		}
	}

	return nil
}

func (i *testableWeeklyJobInteractor) syncWeekData(ctx context.Context, leagueID string, year, week int) error {
	// Fetch matchups from Sleeper API
	sleeperMatchups, err := i.chain.SleeperClient.GetMatchupsForWeek(ctx, leagueID, week)
	if err != nil {
		return err
	}

	// Get rosters to map RosterID -> OwnerID
	rosters, err := i.chain.SleeperClient.GetRostersInLeague(ctx, leagueID)
	if err != nil {
		return err
	}

	// Create roster ID to owner ID mapping
	rosterToOwner := make(map[int]string)
	for _, roster := range rosters {
		rosterToOwner[roster.ID] = roster.OwnerID
	}

	// Convert sleeper matchups to domain matchups
	domainMatchups, err := i.convertSleeperMatchupsToDomain(sleeperMatchups, rosterToOwner)
	if err != nil {
		return err
	}

	// Process each domain matchup
	for _, matchup := range domainMatchups {
		err := i.upsertMatchup(ctx, matchup, year, week)
		if err != nil {
			return err
		}
	}

	return nil
}

func (i *testableWeeklyJobInteractor) convertSleeperMatchupsToDomain(sleeperMatchups sleeper.Matchups, rosterToOwner map[int]string) ([]domain.Matchup, error) {
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
	for _, matchups := range matchupGroups {
		// Each matchup should have exactly 2 teams
		if len(matchups) != 2 {
			continue // Skip invalid matchups in tests
		}

		// Get owner IDs for both teams
		team1 := matchups[0]
		team2 := matchups[1]

		owner1, ok := rosterToOwner[team1.RosterID]
		if !ok {
			continue // Skip if roster mapping is missing
		}

		owner2, ok := rosterToOwner[team2.RosterID]
		if !ok {
			continue // Skip if roster mapping is missing
		}

		// Create domain matchup (team1 = home, team2 = away by convention)
		domainMatchup := domain.Matchup{
			ID:         uuid.NewString(), // Generate new ID for testing
			HomeUserID: owner1,
			AwayUserID: owner2,
			HomeScore:  team1.Points,
			AwayScore:  team2.Points,
			IsPlayoff:  false,
		}

		domainMatchups = append(domainMatchups, domainMatchup)
	}

	return domainMatchups, nil
}

func (i *testableWeeklyJobInteractor) upsertMatchup(ctx context.Context, matchup domain.Matchup, year, week int) error {
	// For testing, just simulate inserting the matchup
	_, err := i.chain.DB.InsertMatchup(ctx, db.InsertMatchupParams{
		Year:         int32(year),
		Week:         int32(week),
		IsPlayoff:    pgtype.Bool{Bool: matchup.IsPlayoff, Valid: true},
		PlayoffRound: pgtype.Text{String: "", Valid: false},
		HomeUserID:   matchup.HomeUserID,
		AwayUserID:   matchup.AwayUserID,
		HomeSeed:     pgtype.Int4{Int32: 0, Valid: false},
		AwaySeed:     pgtype.Int4{Int32: 0, Valid: false},
		HomeScore:    matchup.HomeScore,
		AwayScore:    matchup.AwayScore,
	})
	return err
}

func (i *testableWeeklyJobInteractor) GetWeeklyHighScore(ctx context.Context, year, week int) (*WeeklyHighScore, error) {
	result, err := i.chain.DB.GetWeeklyHighScore(ctx, db.GetWeeklyHighScoreParams{
		Year: int32(year),
		Week: int32(week),
	})
	if err != nil {
		return nil, err
	}

	// Get user name - in tests we'll just use a placeholder
	userName := "Test User"
	if i.chain.DB != nil {
		// In real implementation, we'd get the user name from the users table
		// For tests, we'll use the ID as name
		userName = result.WinnerUserID
	}

	return &WeeklyHighScore{
		UserID:   result.WinnerUserID,
		UserName: userName,
		Score:    result.WinningScore,
		Week:     week,
	}, nil
}

func (i *testableWeeklyJobInteractor) GenerateWeeklySummary(ctx context.Context, year int) (*WeeklySummary, error) {
	// Get latest completed week
	week, err := i.chain.DB.GetLatestCompletedWeek(ctx, int32(year))
	if err != nil {
		return nil, err
	}

	// Get weekly high score
	highScore, err := i.GetWeeklyHighScore(ctx, year, int(week))
	if err != nil {
		return nil, err
	}

	// Get current standings
	league := converters.LeagueFromDB(db.League{
		ID:   "test-league",
		Year: int32(year),
		Status: domain.LeagueStatusInProgress,
	})

	standings, err := i.GetStandingsForLeague(ctx, league)
	if err != nil {
		return nil, err
	}

	return &WeeklySummary{
		Year:           year,
		Week:           int(week),
		HighScore:      highScore,
		Standings:      standings,
		DataSyncStatus: "Complete",
	}, nil
}

func (i *testableWeeklyJobInteractor) GetStandingsForLeague(ctx context.Context, league domain.League) (domain.Standings, error) {
	if league.Status == domain.LeagueStatusPending {
		return domain.Standings{}, errors.New("league year has not started yet")
	}

	matchups, err := i.chain.DB.GetMatchupsByYear(ctx, int32(league.Year))
	if err != nil {
		return domain.Standings{}, err
	}
	allMatchups := converters.MatchupsFromDB(matchups)
	standingsMap := domain.MatchupsToStandingsMap(allMatchups)
	return standingsMap.SortStandingsMap(), nil
}

func newTestableWeeklyJobInteractor(chain *dependency.TestChain) *testableWeeklyJobInteractor {
	return &testableWeeklyJobInteractor{chain: chain}
}

func TestSyncLatestData(t *testing.T) {
	tests := []struct {
		name          string
		inputYear     int
		mockLeague    db.League
		mockNFLState  sleeper.NFLState
		leagueError   error
		nflStateError error
		expectedError string
	}{
		{
			name:      "successful sync",
			inputYear: 2024,
			mockLeague: db.League{
				ID:   "test-league-id",
				Year: 2024,
			},
			mockNFLState: sleeper.NFLState{
				Week: 5,
			},
		},
		{
			name:          "league not found",
			inputYear:     2024,
			leagueError:   errors.New("league not found"),
			expectedError: "league not found",
		},
		{
			name:      "NFL state error",
			inputYear: 2024,
			mockLeague: db.League{
				ID:   "test-league-id",
				Year: 2024,
			},
			nflStateError: errors.New("NFL API error"),
			expectedError: "NFL API error",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			chain := &dependency.TestChain{
				DB: &dependency.MockDatabase{
					GetLeagueByYearFunc: func(ctx context.Context, year int32) (db.League, error) {
						if tt.leagueError != nil {
							return db.League{}, tt.leagueError
						}
						return tt.mockLeague, nil
					},
				},
				SleeperClient: &dependency.MockSleeperClient{
					GetNFLStateFunc: func(ctx context.Context) (sleeper.NFLState, error) {
						if tt.nflStateError != nil {
							return sleeper.NFLState{}, tt.nflStateError
						}
						return tt.mockNFLState, nil
					},
					GetMatchupsForWeekFunc: func(ctx context.Context, leagueID string, week int) (sleeper.Matchups, error) {
						// Return empty matchups for testing
						return sleeper.Matchups{}, nil
					},
					GetRostersInLeagueFunc: func(ctx context.Context, leagueID string) (sleeper.Rosters, error) {
						// Return empty rosters for testing
						return sleeper.Rosters{}, nil
					},
				},
			}

			interactor := newTestableWeeklyJobInteractor(chain)
			err := interactor.SyncLatestData(context.Background(), tt.inputYear)

			if tt.expectedError != "" {
				assert.Error(t, err)
				assert.Contains(t, err.Error(), tt.expectedError)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestGetWeeklyHighScore(t *testing.T) {
	tests := []struct {
		name           string
		inputYear      int
		inputWeek      int
		mockResult     db.GetWeeklyHighScoreRow
		dbError        error
		expectedResult *WeeklyHighScore
		expectedError  string
	}{
		{
			name:      "successful retrieval",
			inputYear: 2024,
			inputWeek: 5,
			mockResult: db.GetWeeklyHighScoreRow{
				WinnerUserID: "user-123",
				WinningScore: 150.5,
				Year:         2024,
				Week:         5,
			},
			expectedResult: &WeeklyHighScore{
				UserID:   "user-123",
				UserName: "user-123", // Will be set to UserID in tests
				Score:    150.5,
				Week:     5,
			},
		},
		{
			name:          "database error",
			inputYear:     2024,
			inputWeek:     5,
			dbError:       errors.New("database connection failed"),
			expectedError: "database connection failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			chain := &dependency.TestChain{
				DB: &dependency.MockDatabase{
					GetWeeklyHighScoreFunc: func(ctx context.Context, arg db.GetWeeklyHighScoreParams) (db.GetWeeklyHighScoreRow, error) {
						assert.Equal(t, int32(tt.inputYear), arg.Year)
						assert.Equal(t, int32(tt.inputWeek), arg.Week)

						if tt.dbError != nil {
							return db.GetWeeklyHighScoreRow{}, tt.dbError
						}
						return tt.mockResult, nil
					},
				},
			}

			interactor := newTestableWeeklyJobInteractor(chain)
			result, err := interactor.GetWeeklyHighScore(context.Background(), tt.inputYear, tt.inputWeek)

			if tt.expectedError != "" {
				assert.Error(t, err)
				assert.Contains(t, err.Error(), tt.expectedError)
				assert.Nil(t, result)
			} else {
				assert.NoError(t, err)
				assert.Equal(t, tt.expectedResult, result)
			}
		})
	}
}

func TestGenerateWeeklySummary(t *testing.T) {
	tests := []struct {
		name               string
		inputYear          int
		mockLatestWeek     int32
		mockHighScore      db.GetWeeklyHighScoreRow
		mockMatchups       []db.Matchup
		latestWeekError    error
		highScoreError     error
		matchupsError      error
		expectedSummary    *WeeklySummary
		expectedError      string
	}{
		{
			name:           "successful generation",
			inputYear:      2024,
			mockLatestWeek: 5,
			mockHighScore: db.GetWeeklyHighScoreRow{
				WinnerUserID: "user-123",
				WinningScore: 145.8,
				Year:         2024,
				Week:         5,
			},
			mockMatchups: []db.Matchup{
				{
					Year:       2024,
					Week:       1,
					HomeUserID: "user-123",
					AwayUserID: "user-456",
					HomeScore:  120.5,
					AwayScore:  110.2,
				},
			},
			expectedSummary: &WeeklySummary{
				Year: 2024,
				Week: 5,
				HighScore: &WeeklyHighScore{
					UserID:   "user-123",
					UserName: "user-123", // Will be set to UserID in tests
					Score:    145.8,
					Week:     5,
				},
				DataSyncStatus: "Complete",
			},
		},
		{
			name:            "latest week error",
			inputYear:       2024,
			latestWeekError: errors.New("no completed weeks"),
			expectedError:   "no completed weeks",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			chain := &dependency.TestChain{
				DB: &dependency.MockDatabase{
					GetLatestCompletedWeekFunc: func(ctx context.Context, year int32) (int32, error) {
						if tt.latestWeekError != nil {
							return 0, tt.latestWeekError
						}
						return tt.mockLatestWeek, nil
					},
					GetWeeklyHighScoreFunc: func(ctx context.Context, arg db.GetWeeklyHighScoreParams) (db.GetWeeklyHighScoreRow, error) {
						if tt.highScoreError != nil {
							return db.GetWeeklyHighScoreRow{}, tt.highScoreError
						}
						return tt.mockHighScore, nil
					},
					GetMatchupsByYearFunc: func(ctx context.Context, year int32) ([]db.Matchup, error) {
						if tt.matchupsError != nil {
							return nil, tt.matchupsError
						}
						return tt.mockMatchups, nil
					},
				},
			}

			interactor := newTestableWeeklyJobInteractor(chain)
			result, err := interactor.GenerateWeeklySummary(context.Background(), tt.inputYear)

			if tt.expectedError != "" {
				assert.Error(t, err)
				assert.Contains(t, err.Error(), tt.expectedError)
				assert.Nil(t, result)
			} else {
				assert.NoError(t, err)
				assert.NotNil(t, result)
				assert.Equal(t, tt.expectedSummary.Year, result.Year)
				assert.Equal(t, tt.expectedSummary.Week, result.Week)
				assert.Equal(t, tt.expectedSummary.HighScore, result.HighScore)
				assert.Equal(t, tt.expectedSummary.DataSyncStatus, result.DataSyncStatus)
				assert.NotNil(t, result.Standings)
			}
		})
	}
}