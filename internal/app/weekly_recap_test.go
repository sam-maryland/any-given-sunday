package app

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewWeeklyRecapApp_MissingEnvironmentVariables(t *testing.T) {
	// Clear environment variables
	originalDB := os.Getenv("DATABASE_URL")
	originalToken := os.Getenv("DISCORD_TOKEN")
	originalChannel := os.Getenv("DISCORD_WEEKLY_RECAP_CHANNEL_ID")
	defer func() {
		os.Setenv("DATABASE_URL", originalDB)
		os.Setenv("DISCORD_TOKEN", originalToken)
		os.Setenv("DISCORD_WEEKLY_RECAP_CHANNEL_ID", originalChannel)
	}()

	tests := []struct {
		name        string
		envVars     map[string]string
		expectedErr string
	}{
		{
			name:        "missing DATABASE_URL",
			envVars:     map[string]string{},
			expectedErr: "DATABASE_URL environment variable is required",
		},
		{
			name: "missing DISCORD_TOKEN",
			envVars: map[string]string{
				"DATABASE_URL": "postgres://test",
			},
			expectedErr: "DISCORD_TOKEN environment variable is required",
		},
		{
			name: "missing DISCORD_WEEKLY_RECAP_CHANNEL_ID",
			envVars: map[string]string{
				"DATABASE_URL":  "postgres://test",
				"DISCORD_TOKEN": "test-token",
			},
			expectedErr: "DISCORD_WEEKLY_RECAP_CHANNEL_ID environment variable is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Clear all environment variables
			os.Unsetenv("DATABASE_URL")
			os.Unsetenv("DISCORD_TOKEN")
			os.Unsetenv("DISCORD_WEEKLY_RECAP_CHANNEL_ID")

			// Set only the provided environment variables
			for key, value := range tt.envVars {
				os.Setenv(key, value)
			}

			app, err := NewWeeklyRecapApp()
			assert.Nil(t, app)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.expectedErr)
		})
	}
}

func TestNewWeeklyRecapApp_ValidEnvironment(t *testing.T) {
	// Set all required environment variables
	os.Setenv("DATABASE_URL", "postgres://test")
	os.Setenv("DISCORD_TOKEN", "test-token")
	os.Setenv("DISCORD_WEEKLY_RECAP_CHANNEL_ID", "test-channel")
	
	defer func() {
		os.Unsetenv("DATABASE_URL")
		os.Unsetenv("DISCORD_TOKEN")
		os.Unsetenv("DISCORD_WEEKLY_RECAP_CHANNEL_ID")
	}()

	// This will fail at database connection, but should pass environment validation
	app, err := NewWeeklyRecapApp()
	assert.Nil(t, app) // Will be nil due to DB connection failure
	assert.Error(t, err) // Expected to fail at DB connection step
	assert.Contains(t, err.Error(), "failed to connect to database") // Should fail at DB, not env validation
}

