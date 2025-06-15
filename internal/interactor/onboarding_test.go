package interactor

import (
	"context"
	"errors"
	"testing"

	"github.com/sam-maryland/any-given-sunday/internal/dependency"
	"github.com/sam-maryland/any-given-sunday/pkg/client/sleeper"
	"github.com/sam-maryland/any-given-sunday/pkg/db"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
)

// testableOnboardingInteractor allows us to test with mock dependencies
type testableOnboardingInteractor struct {
	chain *dependency.TestChain
}

func (i *testableOnboardingInteractor) GetAvailableSleeperUsers(ctx context.Context) ([]AvailableSleeperUser, error) {
	// Get users from DB where discord_id is empty
	users, err := i.chain.DB.GetUsersWithoutDiscordID(ctx)
	if err != nil {
		return nil, err
	}

	// Get current league to fetch roster information
	currentLeague, err := i.chain.DB.GetLatestLeague(ctx)
	if err != nil {
		return nil, err
	}

	// Get rosters from Sleeper API for team names
	rosters, err := i.chain.SleeperClient.GetRostersInLeague(ctx, currentLeague.ID)
	if err != nil {
		return nil, err
	}

	var available []AvailableSleeperUser
	for _, user := range users {
		// Get Sleeper user details
		sleeperUser, err := i.chain.SleeperClient.GetUser(ctx, user.ID)
		if err != nil {
			// Log error but continue with other users
			continue
		}

		// Find the roster owned by this user
		var roster sleeper.Roster
		var found bool
		for _, r := range rosters {
			if r.OwnerID == user.ID {
				roster = r
				found = true
				break
			}
			// Also check co-owners
			for _, coOwner := range r.CoOwners {
				if coOwner == user.ID {
					roster = r
					found = true
					break
				}
			}
			if found {
				break
			}
		}

		// Use team name from Sleeper user metadata, fallback to display name
		teamName := sleeperUser.TeamName()
		if teamName == "" && found {
			teamName = "Team " + string(rune(roster.ID))
		}

		available = append(available, AvailableSleeperUser{
			SleeperUserID: user.ID,
			DisplayName:   sleeperUser.DisplayName,
			Username:      sleeperUser.Username,
			TeamName:      teamName,
			RosterID:      roster.ID,
		})
	}

	return available, nil
}

func (i *testableOnboardingInteractor) LinkDiscordToSleeperUser(ctx context.Context, discordID, sleeperUserID string) error {
	// First check if the Sleeper user is already claimed
	isClaimed, err := i.chain.DB.CheckSleeperUserClaimed(ctx, sleeperUserID)
	if err != nil {
		return err
	}

	if isClaimed {
		return errors.New("this Sleeper account has already been claimed by another Discord user")
	}

	// Check if Discord user is already linked to another account
	isOnboarded, err := i.chain.DB.IsUserOnboarded(ctx, discordID)
	if err != nil {
		return err
	}

	if isOnboarded {
		return errors.New("this Discord user is already linked to a Sleeper account")
	}

	// Attempt to link the accounts
	err = i.chain.DB.UpdateUserDiscordID(ctx, db.UpdateUserDiscordIDParams{
		ID:        sleeperUserID,
		DiscordID: discordID,
	})
	return err
}

func (i *testableOnboardingInteractor) IsUserOnboarded(ctx context.Context, discordID string) (bool, error) {
	return i.chain.DB.IsUserOnboarded(ctx, discordID)
}

func newTestableOnboardingInteractor(chain *dependency.TestChain) *testableOnboardingInteractor {
	return &testableOnboardingInteractor{chain: chain}
}

func TestGetAvailableSleeperUsers(t *testing.T) {
	tests := []struct {
		name             string
		mockUsers        []db.User
		mockLeague       db.League
		mockRosters      sleeper.Rosters
		mockSleeperUsers map[string]sleeper.SleeperUser
		dbError          error
		leagueError      error
		rostersError     error
		sleeperUserError error
		expectedUsers    []AvailableSleeperUser
		expectedError    string
	}{
		{
			name: "successful retrieval with multiple available users",
			mockUsers: []db.User{
				{
					ID:                 "sleeper_user_1",
					Name:               "John Doe",
					DiscordID:          "", // Not claimed
					OnboardingComplete: pgtype.Bool{Bool: false, Valid: true},
				},
				{
					ID:                 "sleeper_user_2",
					Name:               "Jane Smith",
					DiscordID:          "", // Not claimed
					OnboardingComplete: pgtype.Bool{Bool: false, Valid: true},
				},
			},
			mockLeague: db.League{
				ID:   "league123",
				Year: 2024,
			},
			mockRosters: sleeper.Rosters{
				{
					ID:      1,
					OwnerID: "sleeper_user_1",
				},
				{
					ID:      2,
					OwnerID: "sleeper_user_2",
				},
			},
			mockSleeperUsers: map[string]sleeper.SleeperUser{
				"sleeper_user_1": {
					ID:          "sleeper_user_1",
					DisplayName: "John Doe",
					Username:    "johndoe123",
					Metadata:    sleeper.UserMetadata{TeamName: "Dynasty Kings"},
				},
				"sleeper_user_2": {
					ID:          "sleeper_user_2",
					DisplayName: "Jane Smith",
					Username:    "janesmith456",
					Metadata:    sleeper.UserMetadata{TeamName: "Thunder Bolts"},
				},
			},
			expectedUsers: []AvailableSleeperUser{
				{
					SleeperUserID: "sleeper_user_1",
					DisplayName:   "John Doe",
					Username:      "johndoe123",
					TeamName:      "Dynasty Kings",
					RosterID:      1,
				},
				{
					SleeperUserID: "sleeper_user_2",
					DisplayName:   "Jane Smith",
					Username:      "janesmith456",
					TeamName:      "Thunder Bolts",
					RosterID:      2,
				},
			},
		},
		{
			name: "co-owner scenario",
			mockUsers: []db.User{
				{
					ID:                 "sleeper_user_3",
					Name:               "Co Owner",
					DiscordID:          "",
					OnboardingComplete: pgtype.Bool{Bool: false, Valid: true},
				},
			},
			mockLeague: db.League{
				ID:   "league123",
				Year: 2024,
			},
			mockRosters: sleeper.Rosters{
				{
					ID:       1,
					OwnerID:  "sleeper_user_main",
					CoOwners: []string{"sleeper_user_3"}, // Our user is a co-owner
				},
			},
			mockSleeperUsers: map[string]sleeper.SleeperUser{
				"sleeper_user_3": {
					ID:          "sleeper_user_3",
					DisplayName: "Co Owner",
					Username:    "coowner789",
					Metadata:    sleeper.UserMetadata{TeamName: "Shared Team"},
				},
			},
			expectedUsers: []AvailableSleeperUser{
				{
					SleeperUserID: "sleeper_user_3",
					DisplayName:   "Co Owner",
					Username:      "coowner789",
					TeamName:      "Shared Team",
					RosterID:      1,
				},
			},
		},
		{
			name:      "no available users",
			mockUsers: []db.User{}, // No unclaimed users
			mockLeague: db.League{
				ID:   "league123",
				Year: 2024,
			},
			mockRosters:   sleeper.Rosters{},
			expectedUsers: []AvailableSleeperUser{},
		},
		{
			name:          "database error getting users",
			dbError:       errors.New("database connection failed"),
			expectedError: "database connection failed",
		},
		{
			name: "league error",
			mockUsers: []db.User{
				{ID: "sleeper_user_1", DiscordID: ""},
			},
			leagueError:   errors.New("league not found"),
			expectedError: "league not found",
		},
		{
			name: "rosters API error",
			mockUsers: []db.User{
				{ID: "sleeper_user_1", DiscordID: ""},
			},
			mockLeague: db.League{
				ID:   "league123",
				Year: 2024,
			},
			rostersError:  errors.New("Sleeper API unavailable"),
			expectedError: "Sleeper API unavailable",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockDB := &dependency.MockDatabase{
				GetUsersWithoutDiscordIDFunc: func(ctx context.Context) ([]db.User, error) {
					return tt.mockUsers, tt.dbError
				},
				GetLatestLeagueFunc: func(ctx context.Context) (db.League, error) {
					return tt.mockLeague, tt.leagueError
				},
			}

			mockSleeperClient := &dependency.MockSleeperClient{
				GetRostersInLeagueFunc: func(ctx context.Context, leagueID string) (sleeper.Rosters, error) {
					if tt.leagueError == nil {
						assert.Equal(t, tt.mockLeague.ID, leagueID)
					}
					return tt.mockRosters, tt.rostersError
				},
				GetUserFunc: func(ctx context.Context, userID string) (sleeper.SleeperUser, error) {
					if user, ok := tt.mockSleeperUsers[userID]; ok {
						return user, nil
					}
					return sleeper.SleeperUser{}, tt.sleeperUserError
				},
			}

			chain := dependency.NewTestChain(mockDB, mockSleeperClient, nil)
			interactor := newTestableOnboardingInteractor(chain)

			result, err := interactor.GetAvailableSleeperUsers(context.Background())

			if tt.expectedError != "" {
				assert.Error(t, err)
				assert.Contains(t, err.Error(), tt.expectedError)
			} else {
				assert.NoError(t, err)
				assert.Equal(t, len(tt.expectedUsers), len(result))

				// Check that all expected users are present
				for i, expected := range tt.expectedUsers {
					if i < len(result) {
						assert.Equal(t, expected.SleeperUserID, result[i].SleeperUserID)
						assert.Equal(t, expected.DisplayName, result[i].DisplayName)
						assert.Equal(t, expected.Username, result[i].Username)
						assert.Equal(t, expected.TeamName, result[i].TeamName)
						assert.Equal(t, expected.RosterID, result[i].RosterID)
					}
				}
			}
		})
	}
}

func TestLinkDiscordToSleeperUser(t *testing.T) {
	tests := []struct {
		name                 string
		discordID            string
		sleeperUserID        string
		sleeperUserClaimed   bool
		discordUserOnboarded bool
		claimedCheckError    error
		onboardedCheckError  error
		updateError          error
		expectedError        string
	}{
		{
			name:                 "successful linking",
			discordID:            "discord123",
			sleeperUserID:        "sleeper456",
			sleeperUserClaimed:   false,
			discordUserOnboarded: false,
		},
		{
			name:               "sleeper user already claimed",
			discordID:          "discord123",
			sleeperUserID:      "sleeper456",
			sleeperUserClaimed: true,
			expectedError:      "this Sleeper account has already been claimed",
		},
		{
			name:                 "discord user already onboarded",
			discordID:            "discord123",
			sleeperUserID:        "sleeper456",
			sleeperUserClaimed:   false,
			discordUserOnboarded: true,
			expectedError:        "this Discord user is already linked",
		},
		{
			name:              "error checking if sleeper user claimed",
			discordID:         "discord123",
			sleeperUserID:     "sleeper456",
			claimedCheckError: errors.New("database error"),
			expectedError:     "database error",
		},
		{
			name:                "error checking if discord user onboarded",
			discordID:           "discord123",
			sleeperUserID:       "sleeper456",
			sleeperUserClaimed:  false,
			onboardedCheckError: errors.New("database error"),
			expectedError:       "database error",
		},
		{
			name:                 "error updating database",
			discordID:            "discord123",
			sleeperUserID:        "sleeper456",
			sleeperUserClaimed:   false,
			discordUserOnboarded: false,
			updateError:          errors.New("update failed"),
			expectedError:        "update failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockDB := &dependency.MockDatabase{
				CheckSleeperUserClaimedFunc: func(ctx context.Context, id string) (bool, error) {
					assert.Equal(t, tt.sleeperUserID, id)
					return tt.sleeperUserClaimed, tt.claimedCheckError
				},
				IsUserOnboardedFunc: func(ctx context.Context, discordID string) (bool, error) {
					if tt.claimedCheckError == nil {
						assert.Equal(t, tt.discordID, discordID)
					}
					return tt.discordUserOnboarded, tt.onboardedCheckError
				},
				UpdateUserDiscordIDFunc: func(ctx context.Context, arg db.UpdateUserDiscordIDParams) error {
					if tt.claimedCheckError == nil && tt.onboardedCheckError == nil {
						assert.Equal(t, tt.sleeperUserID, arg.ID)
						assert.Equal(t, tt.discordID, arg.DiscordID)
					}
					return tt.updateError
				},
			}

			chain := dependency.NewTestChain(mockDB, nil, nil)
			interactor := newTestableOnboardingInteractor(chain)

			err := interactor.LinkDiscordToSleeperUser(context.Background(), tt.discordID, tt.sleeperUserID)

			if tt.expectedError != "" {
				assert.Error(t, err)
				assert.Contains(t, err.Error(), tt.expectedError)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestIsUserOnboarded(t *testing.T) {
	tests := []struct {
		name           string
		discordID      string
		isOnboarded    bool
		dbError        error
		expectedResult bool
		expectedError  string
	}{
		{
			name:           "user is onboarded",
			discordID:      "discord123",
			isOnboarded:    true,
			expectedResult: true,
		},
		{
			name:           "user is not onboarded",
			discordID:      "discord456",
			isOnboarded:    false,
			expectedResult: false,
		},
		{
			name:          "database error",
			discordID:     "discord789",
			dbError:       errors.New("connection failed"),
			expectedError: "connection failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockDB := &dependency.MockDatabase{
				IsUserOnboardedFunc: func(ctx context.Context, discordID string) (bool, error) {
					assert.Equal(t, tt.discordID, discordID)
					return tt.isOnboarded, tt.dbError
				},
			}

			chain := dependency.NewTestChain(mockDB, nil, nil)
			interactor := newTestableOnboardingInteractor(chain)

			result, err := interactor.IsUserOnboarded(context.Background(), tt.discordID)

			if tt.expectedError != "" {
				assert.Error(t, err)
				assert.Contains(t, err.Error(), tt.expectedError)
			} else {
				assert.NoError(t, err)
				assert.Equal(t, tt.expectedResult, result)
			}
		})
	}
}
