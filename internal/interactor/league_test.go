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

// testableInteractor allows us to test with mock dependencies
type testableInteractor struct {
	chain *dependency.TestChain
}

func (i *testableInteractor) GetLatestLeague(ctx context.Context) (types.League, error) {
	league, err := i.chain.DB.GetLatestLeague(ctx)
	if err != nil {
		return types.League{}, err
	}
	return types.FromDBLeague(league), nil
}

func (i *testableInteractor) GetLeagueByYear(ctx context.Context, year int) (types.League, error) {
	league, err := i.chain.DB.GetLeagueByYear(ctx, int32(year))
	if err != nil {
		return types.League{}, err
	}
	return types.FromDBLeague(league), nil
}

func (i *testableInteractor) GetStandingsForLeague(ctx context.Context, league types.League) (types.Standings, error) {
	if league.Status == types.LeagueStatusPending {
		return types.Standings{}, errors.New("league year has not started yet")
	}

	matchups, err := i.chain.DB.GetMatchupsByYear(ctx, int32(league.Year))
	if err != nil {
		return types.Standings{}, err
	}
	allMatchups := types.FromDBMatchups(matchups)
	standingsMap := types.MatchupsToStandingsMap(allMatchups)
	sortedStandings := standingsMap.SortStandingsMap()

	if league.Status == types.LeagueStatusComplete {
		matchupsByRound := map[string]types.Matchups{}
		for _, m := range allMatchups {
			if !m.IsPlayoff {
				continue
			}
			matchupsByRound[m.PlayoffRound] = append(matchupsByRound[m.PlayoffRound], m)
		}

		finals, ok := matchupsByRound[types.PlayoffRoundFinals]
		if !ok || len(finals) != 1 {
			return types.Standings{}, errors.New("invalid finals data")
		}
		finalsWinner, finalsLoser := finals[0].WinnerAndLoser()
		first, second := standingsMap[finalsWinner], standingsMap[finalsLoser]

		thirdPlaceGame, ok := matchupsByRound[types.PlayoffRoundThirdPlace]
		if !ok || len(thirdPlaceGame) != 1 {
			return types.Standings{}, errors.New("invalid third place game data")
		}
		thirdPlaceGameWinner, thirdPlaceGameLoser := thirdPlaceGame[0].WinnerAndLoser()
		third, fourth := standingsMap[thirdPlaceGameWinner], standingsMap[thirdPlaceGameLoser]

		quarterfinals, ok := matchupsByRound[types.PlayoffRoundQuarterfinals]
		if !ok || len(quarterfinals) != 2 {
			return types.Standings{}, errors.New("invalid quarterfinals data")
		}
		var quarterfinalLosers []string
		for _, q := range quarterfinals {
			quarterfinalLosers = append(quarterfinalLosers, q.Loser())
		}
		sortedQuarterfinalLosers := types.Standings{standingsMap[quarterfinalLosers[0]], standingsMap[quarterfinalLosers[1]]}.SortStandings()

		finalStandings := append(
			types.Standings{first, second, third, fourth, sortedQuarterfinalLosers[0], sortedQuarterfinalLosers[1]},
			sortedStandings[6:]...,
		)

		return finalStandings, nil
	}

	return sortedStandings, nil
}

func newTestableInteractor(chain *dependency.TestChain) *testableInteractor {
	return &testableInteractor{chain: chain}
}

func TestGetLatestLeague(t *testing.T) {
	tests := []struct {
		name           string
		mockLeague     db.League
		mockError      error
		expectedLeague types.League
		expectedError  string
	}{
		{
			name: "successful retrieval",
			mockLeague: db.League{
				ID:          "league-123",
				Year:        2024,
				FirstPlace:  "user1",
				SecondPlace: "user2",
				ThirdPlace:  "user3",
				Status:      types.LeagueStatusComplete,
			},
			expectedLeague: types.League{
				ID:          "league-123",
				Year:        2024,
				FirstPlace:  "user1",
				SecondPlace: "user2",
				ThirdPlace:  "user3",
				Status:      types.LeagueStatusComplete,
			},
		},
		{
			name:          "database error",
			mockError:     errors.New("database connection failed"),
			expectedError: "database connection failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockDB := &dependency.MockDatabase{
				GetLatestLeagueFunc: func(ctx context.Context) (db.League, error) {
					return tt.mockLeague, tt.mockError
				},
			}

			chain := dependency.NewTestChain(mockDB, nil, nil)
			interactor := newTestableInteractor(chain)

			result, err := interactor.GetLatestLeague(context.Background())

			if tt.expectedError != "" {
				assert.Error(t, err)
				assert.Contains(t, err.Error(), tt.expectedError)
			} else {
				assert.NoError(t, err)
				assert.Equal(t, tt.expectedLeague, result)
			}
		})
	}
}

func TestGetLeagueByYear(t *testing.T) {
	tests := []struct {
		name           string
		inputYear      int
		mockLeague     db.League
		mockError      error
		expectedLeague types.League
		expectedError  string
	}{
		{
			name:      "successful retrieval for 2024",
			inputYear: 2024,
			mockLeague: db.League{
				ID:          "league-2024",
				Year:        2024,
				FirstPlace:  "user1",
				SecondPlace: "user2",
				ThirdPlace:  "user3",
				Status:      types.LeagueStatusComplete,
			},
			expectedLeague: types.League{
				ID:          "league-2024",
				Year:        2024,
				FirstPlace:  "user1",
				SecondPlace: "user2",
				ThirdPlace:  "user3",
				Status:      types.LeagueStatusComplete,
			},
		},
		{
			name:      "successful retrieval for 2023",
			inputYear: 2023,
			mockLeague: db.League{
				ID:     "league-2023",
				Year:   2023,
				Status: types.LeagueStatusInProgress,
			},
			expectedLeague: types.League{
				ID:     "league-2023",
				Year:   2023,
				Status: types.LeagueStatusInProgress,
			},
		},
		{
			name:          "database error",
			inputYear:     2022,
			mockError:     errors.New("league not found"),
			expectedError: "league not found",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockDB := &dependency.MockDatabase{
				GetLeagueByYearFunc: func(ctx context.Context, year int32) (db.League, error) {
					assert.Equal(t, int32(tt.inputYear), year)
					return tt.mockLeague, tt.mockError
				},
			}

			chain := dependency.NewTestChain(mockDB, nil, nil)
			interactor := newTestableInteractor(chain)

			result, err := interactor.GetLeagueByYear(context.Background(), tt.inputYear)

			if tt.expectedError != "" {
				assert.Error(t, err)
				assert.Contains(t, err.Error(), tt.expectedError)
			} else {
				assert.NoError(t, err)
				assert.Equal(t, tt.expectedLeague, result)
			}
		})
	}
}

func TestGetStandingsForLeague(t *testing.T) {
	tests := []struct {
		name             string
		inputLeague      types.League
		mockMatchups     []db.Matchup
		mockError        error
		expectedError    string
		validateStandings func(t *testing.T, standings types.Standings)
	}{
		{
			name: "pending league returns error",
			inputLeague: types.League{
				ID:     "league-pending",
				Year:   2024,
				Status: types.LeagueStatusPending,
			},
			expectedError: "league year has not started yet",
		},
		{
			name: "database error",
			inputLeague: types.League{
				ID:     "league-error",
				Year:   2024,
				Status: types.LeagueStatusInProgress,
			},
			mockError:     errors.New("database error"),
			expectedError: "database error",
		},
		{
			name: "in progress league with regular season matchups",
			inputLeague: types.League{
				ID:     "league-in-progress",
				Year:   2024,
				Status: types.LeagueStatusInProgress,
			},
			mockMatchups: []db.Matchup{
				{
					ID:         pgtype.UUID{Bytes: uuid.New(), Valid: true},
					Year:       2024,
					Week:       1,
					HomeUserID: "user1",
					AwayUserID: "user2",
					HomeScore:  150.5,
					AwayScore:  130.2,
					IsPlayoff:  pgtype.Bool{Bool: false, Valid: true},
				},
				{
					ID:         pgtype.UUID{Bytes: uuid.New(), Valid: true},
					Year:       2024,
					Week:       1,
					HomeUserID: "user3",
					AwayUserID: "user4",
					HomeScore:  140.0,
					AwayScore:  120.0,
					IsPlayoff:  pgtype.Bool{Bool: false, Valid: true},
				},
			},
			validateStandings: func(t *testing.T, standings types.Standings) {
				assert.Greater(t, len(standings), 0)
				for i := 1; i < len(standings); i++ {
					assert.True(t, standings[i-1].Wins >= standings[i].Wins || 
						(standings[i-1].Wins == standings[i].Wins && standings[i-1].PointsFor >= standings[i].PointsFor),
						"standings should be sorted by wins then points")
				}
			},
		},
		{
			name: "completed league with playoff results",
			inputLeague: types.League{
				ID:     "league-complete",
				Year:   2024,
				Status: types.LeagueStatusComplete,
			},
			mockMatchups: createCompleteLeagueMatchups(),
			validateStandings: func(t *testing.T, standings types.Standings) {
				assert.Len(t, standings, 6)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockDB := &dependency.MockDatabase{
				GetMatchupsByYearFunc: func(ctx context.Context, year int32) ([]db.Matchup, error) {
					if tt.mockError != nil {
						return nil, tt.mockError
					}
					assert.Equal(t, int32(tt.inputLeague.Year), year)
					return tt.mockMatchups, nil
				},
			}

			chain := dependency.NewTestChain(mockDB, nil, nil)
			interactor := newTestableInteractor(chain)

			result, err := interactor.GetStandingsForLeague(context.Background(), tt.inputLeague)

			if tt.expectedError != "" {
				assert.Error(t, err)
				assert.Contains(t, err.Error(), tt.expectedError)
			} else {
				assert.NoError(t, err)
				if tt.validateStandings != nil {
					tt.validateStandings(t, result)
				}
			}
		})
	}
}

func createCompleteLeagueMatchups() []db.Matchup {
	return []db.Matchup{
		{
			ID:           pgtype.UUID{Bytes: uuid.New(), Valid: true},
			Year:         2024,
			Week:         15,
			HomeUserID:   "user1",
			AwayUserID:   "user2",
			HomeScore:    150.0,
			AwayScore:    140.0,
			IsPlayoff:    pgtype.Bool{Bool: true, Valid: true},
			PlayoffRound: pgtype.Text{String: types.PlayoffRoundFinals, Valid: true},
		},
		{
			ID:           pgtype.UUID{Bytes: uuid.New(), Valid: true},
			Year:         2024,
			Week:         15,
			HomeUserID:   "user3",
			AwayUserID:   "user4",
			HomeScore:    130.0,
			AwayScore:    125.0,
			IsPlayoff:    pgtype.Bool{Bool: true, Valid: true},
			PlayoffRound: pgtype.Text{String: types.PlayoffRoundThirdPlace, Valid: true},
		},
		{
			ID:           pgtype.UUID{Bytes: uuid.New(), Valid: true},
			Year:         2024,
			Week:         14,
			HomeUserID:   "user1",
			AwayUserID:   "user3",
			HomeScore:    145.0,
			AwayScore:    135.0,
			IsPlayoff:    pgtype.Bool{Bool: true, Valid: true},
			PlayoffRound: pgtype.Text{String: types.PlayoffRoundQuarterfinals, Valid: true},
		},
		{
			ID:           pgtype.UUID{Bytes: uuid.New(), Valid: true},
			Year:         2024,
			Week:         14,
			HomeUserID:   "user2",
			AwayUserID:   "user4",
			HomeScore:    140.0,
			AwayScore:    130.0,
			IsPlayoff:    pgtype.Bool{Bool: true, Valid: true},
			PlayoffRound: pgtype.Text{String: types.PlayoffRoundQuarterfinals, Valid: true},
		},
		{
			ID:         pgtype.UUID{Bytes: uuid.New(), Valid: true},
			Year:       2024,
			Week:       1,
			HomeUserID: "user1",
			AwayUserID: "user5",
			HomeScore:  120.0,
			AwayScore:  110.0,
			IsPlayoff:  pgtype.Bool{Bool: false, Valid: true},
		},
		{
			ID:         pgtype.UUID{Bytes: uuid.New(), Valid: true},
			Year:       2024,
			Week:       1,
			HomeUserID: "user6",
			AwayUserID: "user7",
			HomeScore:  100.0,
			AwayScore:  90.0,
			IsPlayoff:  pgtype.Bool{Bool: false, Valid: true},
		},
	}
}