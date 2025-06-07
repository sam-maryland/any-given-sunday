package interactor

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/sam-maryland/any-given-sunday/internal/dependency"
	"github.com/sam-maryland/any-given-sunday/pkg/db"
	"github.com/sam-maryland/any-given-sunday/pkg/types/converters"
	"github.com/sam-maryland/any-given-sunday/pkg/types/domain"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
)

// testableUsersInteractor allows us to test with mock dependencies
type testableUsersInteractor struct {
	chain *dependency.TestChain
}

func (i *testableUsersInteractor) GetUsers(ctx context.Context) (domain.UserMap, error) {
	users, err := i.chain.DB.GetUsers(ctx)
	if err != nil {
		return nil, err
	}
	return converters.UsersToUserMap(users), nil
}

func newTestableUsersInteractor(chain *dependency.TestChain) *testableUsersInteractor {
	return &testableUsersInteractor{chain: chain}
}

func TestGetUsers(t *testing.T) {
	tests := []struct {
		name             string
		mockUsers        []db.User
		dbError          error
		expectedUserMap  domain.UserMap
		expectedError    string
	}{
		{
			name: "successful users retrieval with multiple users",
			mockUsers: []db.User{
				{
					ID:        "user123",
					Name:      "John Doe",
					DiscordID: "discord123",
					CreatedAt: pgtype.Timestamptz{Valid: true},
				},
				{
					ID:        "user456",
					Name:      "Jane Smith",
					DiscordID: "discord456",
					CreatedAt: pgtype.Timestamptz{Valid: true},
				},
				{
					ID:        "user789",
					Name:      "Bob Johnson",
					DiscordID: "discord789",
					CreatedAt: pgtype.Timestamptz{Valid: true},
				},
			},
			expectedUserMap: domain.UserMap{
				"user123": domain.User{
					ID:        "user123",
					Name:      "John Doe",
					DiscordID: "discord123",
				},
				"user456": domain.User{
					ID:        "user456",
					Name:      "Jane Smith",
					DiscordID: "discord456",
				},
				"user789": domain.User{
					ID:        "user789",
					Name:      "Bob Johnson",
					DiscordID: "discord789",
				},
			},
		},
		{
			name: "successful users retrieval with single user",
			mockUsers: []db.User{
				{
					ID:        "user001",
					Name:      "Solo Player",
					DiscordID: "discord001",
					CreatedAt: pgtype.Timestamptz{Valid: true},
				},
			},
			expectedUserMap: domain.UserMap{
				"user001": domain.User{
					ID:        "user001",
					Name:      "Solo Player",
					DiscordID: "discord001",
				},
			},
		},
		{
			name:            "successful users retrieval with no users",
			mockUsers:       []db.User{},
			expectedUserMap: domain.UserMap{},
		},
		{
			name: "users with special characters in names",
			mockUsers: []db.User{
				{
					ID:        "user_special",
					Name:      "José María O'Connor-Smith",
					DiscordID: "discord_special",
					CreatedAt: pgtype.Timestamptz{Valid: true},
				},
				{
					ID:        "user_emoji",
					Name:      "Player 🏈⚡",
					DiscordID: "discord_emoji",
					CreatedAt: pgtype.Timestamptz{Valid: true},
				},
			},
			expectedUserMap: domain.UserMap{
				"user_special": domain.User{
					ID:        "user_special",
					Name:      "José María O'Connor-Smith",
					DiscordID: "discord_special",
				},
				"user_emoji": domain.User{
					ID:        "user_emoji",
					Name:      "Player 🏈⚡",
					DiscordID: "discord_emoji",
				},
			},
		},
		{
			name: "users with empty string values",
			mockUsers: []db.User{
				{
					ID:        "user_empty",
					Name:      "",
					DiscordID: "",
					CreatedAt: pgtype.Timestamptz{Valid: true},
				},
			},
			expectedUserMap: domain.UserMap{
				"user_empty": domain.User{
					ID:        "user_empty",
					Name:      "",
					DiscordID: "",
				},
			},
		},
		{
			name:          "database connection error",
			dbError:       errors.New("database connection failed"),
			expectedError: "database connection failed",
		},
		{
			name:          "database query timeout",
			dbError:       errors.New("query timeout exceeded"),
			expectedError: "query timeout exceeded",
		},
		{
			name:          "database permission denied",
			dbError:       errors.New("permission denied"),
			expectedError: "permission denied",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockDB := &dependency.MockDatabase{
				GetUsersFunc: func(ctx context.Context) ([]db.User, error) {
					return tt.mockUsers, tt.dbError
				},
			}

			chain := dependency.NewTestChain(mockDB, nil, nil)
			interactor := newTestableUsersInteractor(chain)

			result, err := interactor.GetUsers(context.Background())

			if tt.expectedError != "" {
				assert.Error(t, err)
				assert.Contains(t, err.Error(), tt.expectedError)
				assert.Nil(t, result)
			} else {
				assert.NoError(t, err)
				assert.NotNil(t, result)
				assert.Equal(t, tt.expectedUserMap, result)
				
				// Verify the map has the correct number of entries
				assert.Len(t, result, len(tt.mockUsers))
				
				// Verify that all expected users are present with correct data
				for userID, expectedUser := range tt.expectedUserMap {
					actualUser, exists := result[userID]
					assert.True(t, exists, "User %s should exist in result map", userID)
					assert.Equal(t, expectedUser, actualUser)
				}
			}
		})
	}
}

func TestGetUsers_ContextCancellation(t *testing.T) {
	// Test that context cancellation is properly handled
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	mockDB := &dependency.MockDatabase{
		GetUsersFunc: func(ctx context.Context) ([]db.User, error) {
			// Check if context was cancelled
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			default:
				return []db.User{}, nil
			}
		},
	}

	chain := dependency.NewTestChain(mockDB, nil, nil)
	interactor := newTestableUsersInteractor(chain)

	result, err := interactor.GetUsers(ctx)

	assert.Error(t, err)
	assert.Equal(t, context.Canceled, err)
	assert.Nil(t, result)
}

func TestGetUsers_LargeDataSet(t *testing.T) {
	// Test with a large number of users to verify performance characteristics
	const numUsers = 1000
	mockUsers := make([]db.User, numUsers)
	expectedUserMap := make(domain.UserMap)

	for i := 0; i < numUsers; i++ {
		userID := fmt.Sprintf("user%04d", i)
		userName := fmt.Sprintf("User %d", i)
		discordID := fmt.Sprintf("discord%04d", i)
		
		mockUsers[i] = db.User{
			ID:        userID,
			Name:      userName,
			DiscordID: discordID,
			CreatedAt: pgtype.Timestamptz{Valid: true},
		}
		
		expectedUserMap[userID] = domain.User{
			ID:        userID,
			Name:      userName,
			DiscordID: discordID,
		}
	}

	mockDB := &dependency.MockDatabase{
		GetUsersFunc: func(ctx context.Context) ([]db.User, error) {
			return mockUsers, nil
		},
	}

	chain := dependency.NewTestChain(mockDB, nil, nil)
	interactor := newTestableUsersInteractor(chain)

	result, err := interactor.GetUsers(context.Background())

	assert.NoError(t, err)
	assert.NotNil(t, result)
	assert.Len(t, result, numUsers)
	assert.Equal(t, expectedUserMap, result)
}

func TestGetUsers_DuplicateUserIDs(t *testing.T) {
	// Test behavior when database returns duplicate user IDs (shouldn't happen in normal operation)
	mockUsers := []db.User{
		{
			ID:        "duplicate_id",
			Name:      "First User",
			DiscordID: "discord1",
			CreatedAt: pgtype.Timestamptz{Valid: true},
		},
		{
			ID:        "duplicate_id", // Same ID as above
			Name:      "Second User",
			DiscordID: "discord2",
			CreatedAt: pgtype.Timestamptz{Valid: true},
		},
	}

	mockDB := &dependency.MockDatabase{
		GetUsersFunc: func(ctx context.Context) ([]db.User, error) {
			return mockUsers, nil
		},
	}

	chain := dependency.NewTestChain(mockDB, nil, nil)
	interactor := newTestableUsersInteractor(chain)

	result, err := interactor.GetUsers(context.Background())

	assert.NoError(t, err)
	assert.NotNil(t, result)
	
	// The second user should overwrite the first due to map behavior
	assert.Len(t, result, 1)
	user, exists := result["duplicate_id"]
	assert.True(t, exists)
	assert.Equal(t, "Second User", user.Name) // Last one wins
	assert.Equal(t, "discord2", user.DiscordID)
}