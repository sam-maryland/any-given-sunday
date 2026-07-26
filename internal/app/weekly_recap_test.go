package app

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// allEnvVars is the full set of variables the weekly recap reads. Tests clear
// every one of these so a variable leaking in from the developer's shell (or
// from an earlier test) can't change the outcome.
var allEnvVars = []string{
	"DATABASE_URL",
	"DISCORD_TOKEN",
	"DISCORD_WEEKLY_RECAP_CHANNEL_ID",
	"RESEND_API_KEY",
	"FROM_EMAIL",
}

// setEnv clears every variable the weekly recap reads, then applies envVars.
// t.Setenv restores the previous values when the test finishes. An empty value
// is equivalent to unset, since loadWeeklyRecapConfig treats "" as missing.
func setEnv(t *testing.T, envVars map[string]string) {
	t.Helper()
	for _, key := range allEnvVars {
		t.Setenv(key, "")
	}
	for key, value := range envVars {
		t.Setenv(key, value)
	}
}

// TestNewWeeklyRecapApp_MissingEnvironmentVariables verifies which environment
// variables are actually required. Only DATABASE_URL is; the Discord and email
// variables are optional and simply disable those notifications when absent.
// This exercises configuration loading only, so it performs no database I/O.
func TestNewWeeklyRecapApp_MissingEnvironmentVariables(t *testing.T) {
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
			name: "missing DISCORD_TOKEN is allowed",
			envVars: map[string]string{
				"DATABASE_URL":                    "postgres://test",
				"DISCORD_WEEKLY_RECAP_CHANNEL_ID": "test-channel",
			},
		},
		{
			name: "missing DISCORD_WEEKLY_RECAP_CHANNEL_ID is allowed",
			envVars: map[string]string{
				"DATABASE_URL":  "postgres://test",
				"DISCORD_TOKEN": "test-token",
			},
		},
		{
			name: "missing email configuration is allowed",
			envVars: map[string]string{
				"DATABASE_URL": "postgres://test",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setEnv(t, tt.envVars)

			cfg, err := loadWeeklyRecapConfig()

			if tt.expectedErr != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.expectedErr)
				assert.Equal(t, weeklyRecapConfig{}, cfg)
				return
			}

			require.NoError(t, err)
			assert.Equal(t, tt.envVars["DATABASE_URL"], cfg.DatabaseURL)
			assert.Equal(t, tt.envVars["DISCORD_TOKEN"], cfg.DiscordToken)
			assert.Equal(t, tt.envVars["DISCORD_WEEKLY_RECAP_CHANNEL_ID"], cfg.WeeklyRecapChannelID)
		})
	}
}

// TestLoadWeeklyRecapConfig_ValidEnvironment verifies that a fully populated
// environment loads without error and every value is carried through.
func TestLoadWeeklyRecapConfig_ValidEnvironment(t *testing.T) {
	setEnv(t, map[string]string{
		"DATABASE_URL":                    "postgres://user:pass@localhost:5432/test",
		"DISCORD_TOKEN":                   "test-token",
		"DISCORD_WEEKLY_RECAP_CHANNEL_ID": "test-channel",
		"RESEND_API_KEY":                  "test-key",
		"FROM_EMAIL":                      "recap@example.com",
	})

	cfg, err := loadWeeklyRecapConfig()

	require.NoError(t, err)
	assert.Equal(t, weeklyRecapConfig{
		DatabaseURL:          "postgres://user:pass@localhost:5432/test",
		DiscordToken:         "test-token",
		WeeklyRecapChannelID: "test-channel",
		ResendAPIKey:         "test-key",
		FromEmail:            "recap@example.com",
	}, cfg)
}

// TestNewWeeklyRecapApp_MalformedDatabaseURL verifies that an unparseable
// DATABASE_URL fails immediately rather than burning the retry budget on an
// error that retrying cannot fix.
func TestNewWeeklyRecapApp_MalformedDatabaseURL(t *testing.T) {
	// A backoff this large would take a minute if the loop ran at all.
	policy := connectPolicy{MaxAttempts: 3, BackoffUnit: 30 * time.Second}

	start := time.Now()
	app, err := newWeeklyRecapApp(weeklyRecapConfig{DatabaseURL: "not a valid url"}, policy)
	elapsed := time.Since(start)

	assert.Nil(t, app)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to connect to database")
	assert.Contains(t, err.Error(), "invalid DATABASE_URL")
	assert.Less(t, elapsed, time.Second, "malformed URL should fail without retrying")
}

// TestNewWeeklyRecapApp_UnreachableDatabase verifies the retry loop reports the
// configured attempt count and honors the injected backoff. It dials a closed
// port on loopback, so the connection is refused immediately with no DNS lookup.
func TestNewWeeklyRecapApp_UnreachableDatabase(t *testing.T) {
	policy := connectPolicy{MaxAttempts: 3, BackoffUnit: time.Millisecond}
	cfg := weeklyRecapConfig{DatabaseURL: "postgres://user:pass@127.0.0.1:1/test"}

	start := time.Now()
	app, err := newWeeklyRecapApp(cfg, policy)
	elapsed := time.Since(start)

	assert.Nil(t, app)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to connect to database after 3 attempts")
	assert.Less(t, elapsed, 5*time.Second, "retry backoff should be the injected one")
}

// TestDefaultConnectPolicy pins the production retry behavior that the tests
// above deliberately override.
func TestDefaultConnectPolicy(t *testing.T) {
	assert.Equal(t, 3, defaultConnectPolicy.MaxAttempts)
	assert.Equal(t, 2*time.Second, defaultConnectPolicy.BackoffUnit)
}
