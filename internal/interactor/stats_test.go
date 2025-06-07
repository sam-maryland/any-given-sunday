package interactor

import (
	"context"
	"errors"
	"testing"

	"github.com/sam-maryland/any-given-sunday/internal/dependency"
	"github.com/sam-maryland/any-given-sunday/pkg/db"
	"github.com/sam-maryland/any-given-sunday/pkg/types/converters"
	"github.com/sam-maryland/any-given-sunday/pkg/types/domain"

	"github.com/stretchr/testify/assert"
)

// testableStatsInteractor allows us to test with mock dependencies
type testableStatsInteractor struct {
	chain *dependency.TestChain
}

func (i *testableStatsInteractor) GetCareerStatsForDiscordUser(ctx context.Context, userID string) (domain.CareerStats, error) {
	stat, err := i.chain.DB.GetCareerStatsByDiscordID(ctx, userID)
	if err != nil {
		return domain.CareerStats{}, err
	}

	return converters.CareerStatsFromDB(stat), nil
}

func newTestableStatsInteractor(chain *dependency.TestChain) *testableStatsInteractor {
	return &testableStatsInteractor{chain: chain}
}

func TestGetCareerStatsForDiscordUser(t *testing.T) {
	tests := []struct {
		name              string
		inputDiscordID    string
		mockCareerStat    db.CareerStat
		dbError           error
		expectedStats     domain.CareerStats
		expectedError     string
	}{
		{
			name:           "successful career stats retrieval",
			inputDiscordID: "discord123",
			mockCareerStat: db.CareerStat{
				UserID:                     "user456",
				UserName:                   "John Doe",
				DiscordID:                  "discord123",
				SeasonsPlayed:              3,
				RegularSeasonWins:          25,
				RegularSeasonLosses:        14,
				RegularSeasonAvgPoints:     145.67,
				RegularSeasonPointsFor:     float64(5827.2),
				RegularSeasonPointsAgainst: float64(5234.8),
				HighestRegularSeasonScore:  201.3,
				WeeklyHighScores:           8,
				PlayoffAppearances:         2,
				PlayoffWins:                5,
				PlayoffLosses:              3,
				QuarterfinalAppearances:    2,
				SemifinalAppearances:       1,
				FinalsAppearances:          1,
				FirstPlaceFinishes:         1,
				SecondPlaceFinishes:        0,
				ThirdPlaceFinishes:         1,
				PlayoffPointsFor:           float64(1234.5),
				PlayoffPointsAgainst:       float64(1156.7),
				PlayoffAvgPoints:           float64(154.3),
			},
			expectedStats: domain.CareerStats{
				UserID:                     "user456",
				UserName:                   "John Doe",
				SeasonsPlayed:              3,
				RegularSeasonRecord:        "25-14",
				RegularSeasonAvgPoints:     145.67,
				RegularSeasonPointsFor:     5827.2,
				RegularSeasonPointsAgainst: 5234.8,
				HighestRegularSeasonScore:  201.3,
				WeeklyHighScores:           8,
				PlayoffAppearances:         2,
				PlayoffRecord:              "5-3",
				QuarterfinalAppearances:    2,
				SemifinalAppearances:       1,
				FinalsAppearances:          1,
				FirstPlaceFinishes:         1,
				SecondPlaceFinishes:        0,
				ThirdPlaceFinishes:         1,
				PlayoffPointsFor:           1234.5,
				PlayoffPointsAgainst:       1156.7,
				PlayoffAvgPoints:           154.3,
			},
		},
		{
			name:           "career stats with minimal data",
			inputDiscordID: "discord789",
			mockCareerStat: db.CareerStat{
				UserID:                     "user789",
				UserName:                   "Jane Smith",
				DiscordID:                  "discord789",
				SeasonsPlayed:              1,
				RegularSeasonWins:          8,
				RegularSeasonLosses:        5,
				RegularSeasonAvgPoints:     132.45,
				RegularSeasonPointsFor:     float64(1722.85),
				RegularSeasonPointsAgainst: float64(1890.12),
				HighestRegularSeasonScore:  165.8,
				WeeklyHighScores:           2,
				PlayoffAppearances:         1,
				PlayoffWins:                1,
				PlayoffLosses:              1,
				QuarterfinalAppearances:    1,
				SemifinalAppearances:       0,
				FinalsAppearances:          0,
				FirstPlaceFinishes:         0,
				SecondPlaceFinishes:        0,
				ThirdPlaceFinishes:         0,
				PlayoffPointsFor:           float64(267.4),
				PlayoffPointsAgainst:       float64(289.1),
				PlayoffAvgPoints:           float64(133.7),
			},
			expectedStats: domain.CareerStats{
				UserID:                     "user789",
				UserName:                   "Jane Smith",
				SeasonsPlayed:              1,
				RegularSeasonRecord:        "8-5",
				RegularSeasonAvgPoints:     132.45,
				RegularSeasonPointsFor:     1722.85,
				RegularSeasonPointsAgainst: 1890.12,
				HighestRegularSeasonScore:  165.8,
				WeeklyHighScores:           2,
				PlayoffAppearances:         1,
				PlayoffRecord:              "1-1",
				QuarterfinalAppearances:    1,
				SemifinalAppearances:       0,
				FinalsAppearances:          0,
				FirstPlaceFinishes:         0,
				SecondPlaceFinishes:        0,
				ThirdPlaceFinishes:         0,
				PlayoffPointsFor:           267.4,
				PlayoffPointsAgainst:       289.1,
				PlayoffAvgPoints:           133.7,
			},
		},
		{
			name:           "career stats with zero values",
			inputDiscordID: "discord000",
			mockCareerStat: db.CareerStat{
				UserID:                     "user000",
				UserName:                   "New Player",
				DiscordID:                  "discord000",
				SeasonsPlayed:              0,
				RegularSeasonWins:          0,
				RegularSeasonLosses:        0,
				RegularSeasonAvgPoints:     0.0,
				RegularSeasonPointsFor:     float64(0.0),
				RegularSeasonPointsAgainst: float64(0.0),
				HighestRegularSeasonScore:  0.0,
				WeeklyHighScores:           0,
				PlayoffAppearances:         0,
				PlayoffWins:                0,
				PlayoffLosses:              0,
				QuarterfinalAppearances:    0,
				SemifinalAppearances:       0,
				FinalsAppearances:          0,
				FirstPlaceFinishes:         0,
				SecondPlaceFinishes:        0,
				ThirdPlaceFinishes:         0,
				PlayoffPointsFor:           float64(0.0),
				PlayoffPointsAgainst:       float64(0.0),
				PlayoffAvgPoints:           float64(0.0),
			},
			expectedStats: domain.CareerStats{
				UserID:                     "user000",
				UserName:                   "New Player",
				SeasonsPlayed:              0,
				RegularSeasonRecord:        "0-0",
				RegularSeasonAvgPoints:     0.0,
				RegularSeasonPointsFor:     0.0,
				RegularSeasonPointsAgainst: 0.0,
				HighestRegularSeasonScore:  0.0,
				WeeklyHighScores:           0,
				PlayoffAppearances:         0,
				PlayoffRecord:              "0-0",
				QuarterfinalAppearances:    0,
				SemifinalAppearances:       0,
				FinalsAppearances:          0,
				FirstPlaceFinishes:         0,
				SecondPlaceFinishes:        0,
				ThirdPlaceFinishes:         0,
				PlayoffPointsFor:           0.0,
				PlayoffPointsAgainst:       0.0,
				PlayoffAvgPoints:           0.0,
			},
		},
		{
			name:           "database error - user not found",
			inputDiscordID: "nonexistent",
			dbError:        errors.New("user not found"),
			expectedError:  "user not found",
		},
		{
			name:           "database error - connection failure",
			inputDiscordID: "discord123",
			dbError:        errors.New("database connection failed"),
			expectedError:  "database connection failed",
		},
		{
			name:           "database error - query timeout",
			inputDiscordID: "discord456",
			dbError:        errors.New("query timeout"),
			expectedError:  "query timeout",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockDB := &dependency.MockDatabase{
				GetCareerStatsByDiscordIDFunc: func(ctx context.Context, discordID string) (db.CareerStat, error) {
					assert.Equal(t, tt.inputDiscordID, discordID)
					return tt.mockCareerStat, tt.dbError
				},
			}

			chain := dependency.NewTestChain(mockDB, nil, nil)
			interactor := newTestableStatsInteractor(chain)

			result, err := interactor.GetCareerStatsForDiscordUser(context.Background(), tt.inputDiscordID)

			if tt.expectedError != "" {
				assert.Error(t, err)
				assert.Contains(t, err.Error(), tt.expectedError)
				assert.Equal(t, domain.CareerStats{}, result)
			} else {
				assert.NoError(t, err)
				assert.Equal(t, tt.expectedStats, result)
			}
		})
	}
}

func TestGetCareerStatsForDiscordUser_ContextCancellation(t *testing.T) {
	// Test that context cancellation is properly handled
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	mockDB := &dependency.MockDatabase{
		GetCareerStatsByDiscordIDFunc: func(ctx context.Context, discordID string) (db.CareerStat, error) {
			// Check if context was cancelled
			select {
			case <-ctx.Done():
				return db.CareerStat{}, ctx.Err()
			default:
				return db.CareerStat{}, nil
			}
		},
	}

	chain := dependency.NewTestChain(mockDB, nil, nil)
	interactor := newTestableStatsInteractor(chain)

	result, err := interactor.GetCareerStatsForDiscordUser(ctx, "discord123")

	assert.Error(t, err)
	assert.Equal(t, context.Canceled, err)
	assert.Equal(t, domain.CareerStats{}, result)
}

func TestGetCareerStatsForDiscordUser_EmptyDiscordID(t *testing.T) {
	// Test behavior with empty Discord ID
	mockDB := &dependency.MockDatabase{
		GetCareerStatsByDiscordIDFunc: func(ctx context.Context, discordID string) (db.CareerStat, error) {
			assert.Equal(t, "", discordID)
			return db.CareerStat{}, errors.New("invalid discord ID")
		},
	}

	chain := dependency.NewTestChain(mockDB, nil, nil)
	interactor := newTestableStatsInteractor(chain)

	result, err := interactor.GetCareerStatsForDiscordUser(context.Background(), "")

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid discord ID")
	assert.Equal(t, domain.CareerStats{}, result)
}