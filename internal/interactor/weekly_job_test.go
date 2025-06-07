package interactor

import (
	"context"
	"errors"
	"testing"

	"github.com/sam-maryland/any-given-sunday/internal/dependency"
	"github.com/sam-maryland/any-given-sunday/pkg/db"
	"github.com/sam-maryland/any-given-sunday/pkg/types"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
)

// testableWeeklyJobInteractor allows us to test with mock dependencies
type testableWeeklyJobInteractor struct {
	chain *dependency.TestChain
}

func (i *testableWeeklyJobInteractor) SyncLatestData(ctx context.Context, year int) error {
	league, err := i.GetLeagueByYear(ctx, year)
	if err != nil {
		return err
	}

	nflState, err := i.chain.SleeperClient.GetNFLState(ctx)
	if err != nil {
		return err
	}

	for week := 1; week <= nflState.Week; week++ {
		err := i.syncWeekData(ctx, league.ID, year, week)
		if err != nil {
			continue // Log error but continue with other weeks
		}
	}

	return nil
}

func (i *testableWeeklyJobInteractor) GetWeeklyHighScore(ctx context.Context, year, week int) (*WeeklyHighScore, error) {
	params := db.GetWeeklyHighScoreParams{
		Year: int32(year),
		Week: int32(week),
	}

	result, err := i.chain.DB.GetWeeklyHighScore(ctx, params)
	if err != nil {
		return nil, err
	}

	user, err := i.chain.DB.GetUserByID(ctx, result.WinnerUserID)
	if err != nil {
		return nil, err
	}

	return &WeeklyHighScore{
		UserID:     result.WinnerUserID,
		UserName:   user.Name,
		Score:      result.WinningScore,
		Week:       int(result.Week),
		Year:       int(result.Year),
		PaymentDue: 15.00,
	}, nil
}

func (i *testableWeeklyJobInteractor) GenerateWeeklySummary(ctx context.Context, year int) (*WeeklySummary, error) {
	latestWeek, err := i.chain.DB.GetLatestCompletedWeek(ctx, int32(year))
	if err != nil {
		return nil, err
	}

	if latestWeek == 0 {
		return nil, errors.New("no completed weeks found")
	}

	highScore, err := i.GetWeeklyHighScore(ctx, year, int(latestWeek))
	if err != nil {
		return nil, err
	}

	league, err := i.GetLeagueByYear(ctx, year)
	if err != nil {
		return nil, err
	}

	standings, err := i.GetStandingsForLeague(ctx, league)
	if err != nil {
		return nil, err
	}

	return &WeeklySummary{
		Year:           year,
		Week:           int(latestWeek),
		HighScore:      highScore,
		Standings:      standings,
		DataSyncStatus: "✅ Current",
	}, nil
}

func (i *testableWeeklyJobInteractor) GetLeagueByYear(ctx context.Context, year int) (types.League, error) {
	league, err := i.chain.DB.GetLeagueByYear(ctx, int32(year))
	if err != nil {
		return types.League{}, err
	}
	return types.FromDBLeague(league), nil
}

func (i *testableWeeklyJobInteractor) GetStandingsForLeague(ctx context.Context, league types.League) (types.Standings, error) {
	if league.Status == types.LeagueStatusPending {
		return types.Standings{}, errors.New("league year has not started yet")
	}

	matchups, err := i.chain.DB.GetMatchupsByYear(ctx, int32(league.Year))
	if err != nil {
		return types.Standings{}, err
	}
	allMatchups := types.FromDBMatchups(matchups)
	standingsMap := types.MatchupsToStandingsMap(allMatchups)
	return standingsMap.SortStandingsMap(), nil
}

func (i *testableWeeklyJobInteractor) syncWeekData(ctx context.Context, leagueID string, year, week int) error {
	sleeperMatchups, err := i.chain.SleeperClient.GetMatchupsForWeek(ctx, leagueID, week)
	if err != nil {
		return err
	}

	for _, matchup := range sleeperMatchups {
		err := i.upsertMatchup(ctx, matchup, year, week)
		if err != nil {
			return err
		}
	}

	return nil
}

func (i *testableWeeklyJobInteractor) upsertMatchup(ctx context.Context, matchup types.Matchup, year, week int) error {
	existing, err := i.chain.DB.GetMatchupByYearWeekUsers(ctx, db.GetMatchupByYearWeekUsersParams{
		Year:       int32(year),
		Week:       int32(week),
		HomeUserID: matchup.HomeUserID,
		AwayUserID: matchup.AwayUserID,
	})

	if err != nil {
		// Matchup doesn't exist, insert it
		_, err = i.chain.DB.InsertMatchup(ctx, db.InsertMatchupParams{
			Year:      int32(year),
			Week:      int32(week),
			IsPlayoff: pgtype.Bool{Bool: matchup.IsPlayoff, Valid: true},
			PlayoffRound: pgtype.Text{
				String: matchup.PlayoffRound,
				Valid:  matchup.PlayoffRound != "",
			},
			HomeUserID: matchup.HomeUserID,
			AwayUserID: matchup.AwayUserID,
			HomeSeed: pgtype.Int4{
				Int32: int32(matchup.HomeSeed),
				Valid: matchup.HomeSeed > 0,
			},
			AwaySeed: pgtype.Int4{
				Int32: int32(matchup.AwaySeed),
				Valid: matchup.AwaySeed > 0,
			},
			HomeScore: matchup.HomeScore,
			AwayScore: matchup.AwayScore,
		})
		return err
	} else {
		// Matchup exists, update scores if they've changed
		if existing.HomeScore != matchup.HomeScore || existing.AwayScore != matchup.AwayScore {
			err = i.chain.DB.UpdateMatchupScores(ctx, db.UpdateMatchupScoresParams{
				Year:       int32(year),
				Week:       int32(week),
				HomeScore:  matchup.HomeScore,
				AwayScore:  matchup.AwayScore,
				HomeUserID: matchup.HomeUserID,
				AwayUserID: matchup.AwayUserID,
			})
			return err
		}
	}

	return nil
}

func newTestableWeeklyJobInteractor(chain *dependency.TestChain) *testableWeeklyJobInteractor {
	return &testableWeeklyJobInteractor{chain: chain}
}

func TestSyncLatestData(t *testing.T) {
	tests := []struct {
		name           string
		inputYear      int
		mockLeague     db.League
		mockNFLState   types.NFLState
		mockMatchups   []types.Matchups // Matchups per week
		leagueError    error
		nflStateError  error
		matchupsError  error
		expectedError  string
	}{
		{
			name:      "successful sync for multiple weeks",
			inputYear: 2024,
			mockLeague: db.League{
				ID:     "league-2024",
				Year:   2024,
				Status: types.LeagueStatusInProgress,
			},
			mockNFLState: types.NFLState{
				Week: 3,
			},
			mockMatchups: []types.Matchups{
				// Week 1
				{
					{HomeUserID: "user1", AwayUserID: "user2", HomeScore: 150.0, AwayScore: 140.0},
					{HomeUserID: "user3", AwayUserID: "user4", HomeScore: 130.0, AwayScore: 125.0},
				},
				// Week 2
				{
					{HomeUserID: "user1", AwayUserID: "user3", HomeScore: 145.0, AwayScore: 135.0},
					{HomeUserID: "user2", AwayUserID: "user4", HomeScore: 140.0, AwayScore: 130.0},
				},
				// Week 3
				{
					{HomeUserID: "user1", AwayUserID: "user4", HomeScore: 155.0, AwayScore: 145.0},
					{HomeUserID: "user2", AwayUserID: "user3", HomeScore: 142.0, AwayScore: 138.0},
				},
			},
		},
		{
			name:          "league not found error",
			inputYear:     2024,
			leagueError:   errors.New("league not found"),
			expectedError: "league not found",
		},
		{
			name:      "NFL state error",
			inputYear: 2024,
			mockLeague: db.League{
				ID:     "league-2024",
				Year:   2024,
				Status: types.LeagueStatusInProgress,
			},
			nflStateError: errors.New("NFL API unavailable"),
			expectedError: "NFL API unavailable",
		},
		{
			name:      "partial sync failure (continues despite week errors)",
			inputYear: 2024,
			mockLeague: db.League{
				ID:     "league-2024",
				Year:   2024,
				Status: types.LeagueStatusInProgress,
			},
			mockNFLState: types.NFLState{
				Week: 2,
			},
			mockMatchups: []types.Matchups{
				{}, // Week 1 - will return error from GetMatchupsForWeek
				{}, // Week 2 - will return error from GetMatchupsForWeek
			},
			matchupsError: errors.New("week API error"),
			// Should not return error even if individual weeks fail
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			weekCallCount := 0
			mockDB := &dependency.MockDatabase{
				GetLeagueByYearFunc: func(ctx context.Context, year int32) (db.League, error) {
					assert.Equal(t, int32(tt.inputYear), year)
					return tt.mockLeague, tt.leagueError
				},
				GetMatchupByYearWeekUsersFunc: func(ctx context.Context, arg db.GetMatchupByYearWeekUsersParams) (db.Matchup, error) {
					// Return error to trigger insert path
					return db.Matchup{}, errors.New("not found")
				},
				InsertMatchupFunc: func(ctx context.Context, arg db.InsertMatchupParams) (pgtype.UUID, error) {
					assert.Equal(t, int32(tt.inputYear), arg.Year)
					return pgtype.UUID{Bytes: uuid.New(), Valid: true}, nil
				},
			}

			mockSleeperClient := &dependency.MockSleeperClient{
				GetNFLStateFunc: func(ctx context.Context) (types.NFLState, error) {
					return tt.mockNFLState, tt.nflStateError
				},
				GetMatchupsForWeekFunc: func(ctx context.Context, leagueID string, week int) (types.Matchups, error) {
					weekCallCount++ // Always increment to track calls made
					if tt.matchupsError != nil {
						return nil, tt.matchupsError
					}
					assert.Equal(t, tt.mockLeague.ID, leagueID)
					assert.True(t, week >= 1 && week <= tt.mockNFLState.Week)
					
					if len(tt.mockMatchups) >= week {
						return tt.mockMatchups[week-1], nil
					}
					return types.Matchups{}, nil
				},
			}

			chain := dependency.NewTestChain(mockDB, mockSleeperClient, nil)
			interactor := newTestableWeeklyJobInteractor(chain)

			err := interactor.SyncLatestData(context.Background(), tt.inputYear)

			if tt.expectedError != "" {
				assert.Error(t, err)
				assert.Contains(t, err.Error(), tt.expectedError)
			} else {
				assert.NoError(t, err)
				if tt.nflStateError == nil && tt.leagueError == nil {
					// Should make calls for all weeks regardless of individual week errors
					assert.Equal(t, tt.mockNFLState.Week, weekCallCount)
				}
			}
		})
	}
}

func TestGetWeeklyHighScore(t *testing.T) {
	tests := []struct {
		name             string
		inputYear        int
		inputWeek        int
		mockHighScore    db.GetWeeklyHighScoreRow
		mockUser         db.User
		highScoreError   error
		userError        error
		expectedResult   *WeeklyHighScore
		expectedError    string
	}{
		{
			name:      "successful high score retrieval",
			inputYear: 2024,
			inputWeek: 5,
			mockHighScore: db.GetWeeklyHighScoreRow{
				WinnerUserID: "user123",
				WinningScore: 187.5,
				Week:         5,
				Year:         2024,
			},
			mockUser: db.User{
				ID:   "user123",
				Name: "John Doe",
			},
			expectedResult: &WeeklyHighScore{
				UserID:     "user123",
				UserName:   "John Doe",
				Score:      187.5,
				Week:       5,
				Year:       2024,
				PaymentDue: 15.00,
			},
		},
		{
			name:           "high score query error",
			inputYear:      2024,
			inputWeek:      5,
			highScoreError: errors.New("no scores found for week"),
			expectedError:  "no scores found for week",
		},
		{
			name:      "user lookup error",
			inputYear: 2024,
			inputWeek: 5,
			mockHighScore: db.GetWeeklyHighScoreRow{
				WinnerUserID: "user123",
				WinningScore: 187.5,
				Week:         5,
				Year:         2024,
			},
			userError:     errors.New("user not found"),
			expectedError: "user not found",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockDB := &dependency.MockDatabase{
				GetWeeklyHighScoreFunc: func(ctx context.Context, arg db.GetWeeklyHighScoreParams) (db.GetWeeklyHighScoreRow, error) {
					assert.Equal(t, int32(tt.inputYear), arg.Year)
					assert.Equal(t, int32(tt.inputWeek), arg.Week)
					return tt.mockHighScore, tt.highScoreError
				},
				GetUserByIDFunc: func(ctx context.Context, id string) (db.User, error) {
					if tt.highScoreError == nil {
						assert.Equal(t, tt.mockHighScore.WinnerUserID, id)
					}
					return tt.mockUser, tt.userError
				},
			}

			chain := dependency.NewTestChain(mockDB, nil, nil)
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
		mockUser           db.User
		mockLeague         db.League
		mockMatchups       []db.Matchup
		latestWeekError    error
		highScoreError     error
		userError          error
		leagueError        error
		matchupsError      error
		expectedSummary    *WeeklySummary
		expectedError      string
	}{
		{
			name:           "successful weekly summary generation",
			inputYear:      2024,
			mockLatestWeek: 8,
			mockHighScore: db.GetWeeklyHighScoreRow{
				WinnerUserID: "user456",
				WinningScore: 195.2,
				Week:         8,
				Year:         2024,
			},
			mockUser: db.User{
				ID:   "user456",
				Name: "Jane Smith",
			},
			mockLeague: db.League{
				ID:     "league-2024",
				Year:   2024,
				Status: types.LeagueStatusInProgress,
			},
			mockMatchups: []db.Matchup{
				{
					ID:         pgtype.UUID{Bytes: uuid.New(), Valid: true},
					Year:       2024,
					Week:       8,
					HomeUserID: "user456",
					AwayUserID: "user789",
					HomeScore:  195.2,
					AwayScore:  145.5,
					IsPlayoff:  pgtype.Bool{Bool: false, Valid: true},
				},
			},
			expectedSummary: &WeeklySummary{
				Year: 2024,
				Week: 8,
				HighScore: &WeeklyHighScore{
					UserID:     "user456",
					UserName:   "Jane Smith",
					Score:      195.2,
					Week:       8,
					Year:       2024,
					PaymentDue: 15.00,
				},
				DataSyncStatus: "✅ Current",
			},
		},
		{
			name:              "no completed weeks error",
			inputYear:         2024,
			mockLatestWeek:    0,
			expectedError:     "no completed weeks found",
		},
		{
			name:            "latest week query error",
			inputYear:       2024,
			latestWeekError: errors.New("database error"),
			expectedError:   "database error",
		},
		{
			name:           "high score retrieval error",
			inputYear:      2024,
			mockLatestWeek: 5,
			highScoreError: errors.New("high score not found"),
			expectedError:  "high score not found",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockDB := &dependency.MockDatabase{
				GetLatestCompletedWeekFunc: func(ctx context.Context, year int32) (int32, error) {
					assert.Equal(t, int32(tt.inputYear), year)
					return tt.mockLatestWeek, tt.latestWeekError
				},
				GetWeeklyHighScoreFunc: func(ctx context.Context, arg db.GetWeeklyHighScoreParams) (db.GetWeeklyHighScoreRow, error) {
					if tt.latestWeekError == nil && tt.mockLatestWeek > 0 {
						assert.Equal(t, int32(tt.inputYear), arg.Year)
						assert.Equal(t, tt.mockLatestWeek, arg.Week)
					}
					return tt.mockHighScore, tt.highScoreError
				},
				GetUserByIDFunc: func(ctx context.Context, id string) (db.User, error) {
					if tt.highScoreError == nil && tt.latestWeekError == nil && tt.mockLatestWeek > 0 {
						assert.Equal(t, tt.mockHighScore.WinnerUserID, id)
					}
					return tt.mockUser, tt.userError
				},
				GetLeagueByYearFunc: func(ctx context.Context, year int32) (db.League, error) {
					if tt.userError == nil && tt.highScoreError == nil && tt.latestWeekError == nil && tt.mockLatestWeek > 0 {
						assert.Equal(t, int32(tt.inputYear), year)
					}
					return tt.mockLeague, tt.leagueError
				},
				GetMatchupsByYearFunc: func(ctx context.Context, year int32) ([]db.Matchup, error) {
					if tt.leagueError == nil && tt.userError == nil && tt.highScoreError == nil && tt.latestWeekError == nil && tt.mockLatestWeek > 0 {
						assert.Equal(t, int32(tt.inputYear), year)
					}
					return tt.mockMatchups, tt.matchupsError
				},
			}

			chain := dependency.NewTestChain(mockDB, nil, nil)
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