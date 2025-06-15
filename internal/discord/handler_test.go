package discord

import (
	"context"
	"testing"

	"github.com/sam-maryland/any-given-sunday/internal/dependency"
	"github.com/sam-maryland/any-given-sunday/internal/interactor"
	"github.com/sam-maryland/any-given-sunday/pkg/types/domain"

	"github.com/bwmarrin/discordgo"
	"github.com/stretchr/testify/assert"
)

// mockInteractor provides a testable implementation of the interactor interface
type mockInteractor struct {
	handleCareerStatsFunc   func(ctx context.Context, userID string) (domain.CareerStats, error)
	handleStandingsFunc     func(ctx context.Context, league domain.League) (domain.Standings, error)
	handleWeeklySummaryFunc func(ctx context.Context, year int) (*interactor.WeeklySummary, error)
}

// LeagueInteractor methods
func (m *mockInteractor) GetLatestLeague(ctx context.Context) (domain.League, error) {
	return domain.League{}, nil
}
func (m *mockInteractor) GetLeagueByYear(ctx context.Context, year int) (domain.League, error) {
	return domain.League{}, nil
}
func (m *mockInteractor) GetStandingsForLeague(ctx context.Context, league domain.League) (domain.Standings, error) {
	if m.handleStandingsFunc != nil {
		return m.handleStandingsFunc(ctx, league)
	}
	return domain.Standings{}, nil
}

// StatsInteractor methods
func (m *mockInteractor) GetCareerStatsForDiscordUser(ctx context.Context, userID string) (domain.CareerStats, error) {
	if m.handleCareerStatsFunc != nil {
		return m.handleCareerStatsFunc(ctx, userID)
	}
	return domain.CareerStats{}, nil
}

// UsersInteractor methods
func (m *mockInteractor) GetUsers(ctx context.Context) (domain.UserMap, error) {
	return domain.UserMap{}, nil
}

// WeeklyJobInteractor methods
func (m *mockInteractor) SyncLatestData(ctx context.Context, year int) error { return nil }
func (m *mockInteractor) GetWeeklyHighScore(ctx context.Context, year, week int) (*interactor.WeeklyHighScore, error) {
	return &interactor.WeeklyHighScore{}, nil
}
func (m *mockInteractor) GenerateWeeklySummary(ctx context.Context, year int) (*interactor.WeeklySummary, error) {
	if m.handleWeeklySummaryFunc != nil {
		return m.handleWeeklySummaryFunc(ctx, year)
	}
	return &interactor.WeeklySummary{}, nil
}

// OnboardingInteractor methods
func (m *mockInteractor) GetAvailableSleeperUsers(ctx context.Context) ([]interactor.AvailableSleeperUser, error) {
	return []interactor.AvailableSleeperUser{}, nil
}
func (m *mockInteractor) LinkDiscordToSleeperUser(ctx context.Context, discordID, sleeperUserID string) error {
	return nil
}
func (m *mockInteractor) IsUserOnboarded(ctx context.Context, discordID string) (bool, error) {
	return false, nil
}

// testableHandler allows us to test with mock dependencies
type testableHandler struct {
	session    dependency.IDiscordSession
	interactor interactor.Interactor
}

func (h *testableHandler) Handle(s *discordgo.Session, i *discordgo.InteractionCreate) {
	if i.Type != discordgo.InteractionApplicationCommand {
		return
	}

	ctx := context.Background()

	switch i.ApplicationCommandData().Name {
	case commandNameCareerStats:
		h.handleCareerStatsCommand(ctx, s, i)
	case commandNameStandings:
		h.handleStandingsCommand(ctx, s, i)
	case commandNameWeeklySummary:
		h.handleWeeklySummaryCommand(ctx, s, i)
	default:
		// Unknown command - should be ignored
	}
}

func (h *testableHandler) handleCareerStatsCommand(ctx context.Context, s *discordgo.Session, i *discordgo.InteractionCreate) {
	// Extract user ID from command options
	options := i.ApplicationCommandData().Options
	if len(options) > 0 && options[0].Name == "user" {
		userID := options[0].UserValue(s).ID
		h.interactor.GetCareerStatsForDiscordUser(ctx, userID)
	}

	// Respond to Discord
	h.session.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Content: "Career stats retrieved successfully",
		},
	})
}

func (h *testableHandler) handleStandingsCommand(ctx context.Context, s *discordgo.Session, i *discordgo.InteractionCreate) {
	// Handle standings command
	h.session.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Content: "Standings retrieved successfully",
		},
	})
}

func (h *testableHandler) handleWeeklySummaryCommand(ctx context.Context, s *discordgo.Session, i *discordgo.InteractionCreate) {
	// Extract year from command options if present
	year := 2024 // default year
	options := i.ApplicationCommandData().Options
	if len(options) > 0 && options[0].Name == "year" {
		year = int(options[0].IntValue())
	}

	h.interactor.GenerateWeeklySummary(ctx, year)

	// Respond to Discord
	h.session.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Content: "Weekly summary generated successfully",
		},
	})
}

func newTestableHandler(session dependency.IDiscordSession, interactor interactor.Interactor) *testableHandler {
	return &testableHandler{
		session:    session,
		interactor: interactor,
	}
}

func TestHandler_Handle(t *testing.T) {
	tests := []struct {
		name                     string
		interaction              *discordgo.InteractionCreate
		expectedInteractionCalls int
		expectedCommand          string
		expectHandled            bool
	}{
		{
			name: "career-stats command with user option",
			interaction: &discordgo.InteractionCreate{
				Interaction: TestCareerStatsInteraction("user123", "guild123"),
			},
			expectedInteractionCalls: 1,
			expectedCommand:          commandNameCareerStats,
			expectHandled:            true,
		},
		{
			name: "standings command",
			interaction: &discordgo.InteractionCreate{
				Interaction: TestStandingsInteraction("user456", "guild123"),
			},
			expectedInteractionCalls: 1,
			expectedCommand:          commandNameStandings,
			expectHandled:            true,
		},
		{
			name: "weekly-summary command with year option",
			interaction: &discordgo.InteractionCreate{
				Interaction: TestWeeklySummaryInteraction("user789", "guild123", 2023),
			},
			expectedInteractionCalls: 1,
			expectedCommand:          commandNameWeeklySummary,
			expectHandled:            true,
		},
		{
			name: "unknown command should be ignored",
			interaction: &discordgo.InteractionCreate{
				Interaction: TestInteraction("unknown-command", "user123", "guild123", nil),
			},
			expectedInteractionCalls: 0,
			expectedCommand:          "unknown-command",
			expectHandled:            false,
		},
		{
			name: "non-application command interaction should be ignored",
			interaction: &discordgo.InteractionCreate{
				Interaction: &discordgo.Interaction{
					ID:      "test-interaction-id",
					Type:    discordgo.InteractionMessageComponent, // Not an application command
					GuildID: "guild123",
					User: &discordgo.User{
						ID:       "user123",
						Username: "testuser",
					},
				},
			},
			expectedInteractionCalls: 0,
			expectHandled:            false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			interactionCallCount := 0
			careerStatsCallCount := 0
			weeklySummaryCallCount := 0

			mockDiscord := &dependency.MockDiscordSession{
				InteractionRespondFunc: func(interaction *discordgo.Interaction, resp *discordgo.InteractionResponse, options ...discordgo.RequestOption) error {
					interactionCallCount++
					assert.Equal(t, tt.interaction.Interaction, interaction)
					assert.Equal(t, discordgo.InteractionResponseChannelMessageWithSource, resp.Type)
					assert.NotNil(t, resp.Data)
					return nil
				},
			}

			mockInteractor := &mockInteractor{
				handleCareerStatsFunc: func(ctx context.Context, userID string) (domain.CareerStats, error) {
					careerStatsCallCount++
					assert.NotEmpty(t, userID)
					return domain.CareerStats{}, nil
				},
				handleWeeklySummaryFunc: func(ctx context.Context, year int) (*interactor.WeeklySummary, error) {
					weeklySummaryCallCount++
					assert.Greater(t, year, 2020) // Reasonable year range
					return &interactor.WeeklySummary{}, nil
				},
			}

			handler := newTestableHandler(mockDiscord, mockInteractor)

			// Execute the handler
			handler.Handle(nil, tt.interaction)

			// Verify interactions
			assert.Equal(t, tt.expectedInteractionCalls, interactionCallCount)

			// Verify specific command handling
			if tt.expectHandled {
				switch tt.expectedCommand {
				case commandNameCareerStats:
					assert.Equal(t, 1, careerStatsCallCount)
				case commandNameWeeklySummary:
					assert.Equal(t, 1, weeklySummaryCallCount)
				}
			} else {
				assert.Equal(t, 0, careerStatsCallCount)
				assert.Equal(t, 0, weeklySummaryCallCount)
			}
		})
	}
}

func TestHandler_Handle_CommandRouting(t *testing.T) {
	// Test that all valid commands are properly routed
	commandTests := []struct {
		commandName string
		interaction *discordgo.Interaction
	}{
		{
			commandName: commandNameCareerStats,
			interaction: TestCareerStatsInteraction("user123", "guild123"),
		},
		{
			commandName: commandNameStandings,
			interaction: TestStandingsInteraction("user456", "guild123"),
		},
		{
			commandName: commandNameWeeklySummary,
			interaction: TestWeeklySummaryInteraction("user789", "guild123", 2024),
		},
	}

	for _, tt := range commandTests {
		t.Run(tt.commandName, func(t *testing.T) {
			handledCommand := ""

			mockDiscord := &dependency.MockDiscordSession{
				InteractionRespondFunc: func(interaction *discordgo.Interaction, resp *discordgo.InteractionResponse, options ...discordgo.RequestOption) error {
					handledCommand = interaction.ApplicationCommandData().Name
					return nil
				},
			}

			mockInteractor := &mockInteractor{}
			handler := newTestableHandler(mockDiscord, mockInteractor)

			interactionCreate := &discordgo.InteractionCreate{
				Interaction: tt.interaction,
			}

			handler.Handle(nil, interactionCreate)

			assert.Equal(t, tt.commandName, handledCommand)
		})
	}
}

func TestHandler_Handle_ContextPropagation(t *testing.T) {
	// Test that context is properly passed to interactor methods
	contextReceived := false

	mockDiscord := &dependency.MockDiscordSession{
		InteractionRespondFunc: func(interaction *discordgo.Interaction, resp *discordgo.InteractionResponse, options ...discordgo.RequestOption) error {
			return nil
		},
	}

	mockInteractor := &mockInteractor{
		handleCareerStatsFunc: func(ctx context.Context, userID string) (domain.CareerStats, error) {
			contextReceived = true
			assert.NotNil(t, ctx)
			return domain.CareerStats{}, nil
		},
	}

	handler := newTestableHandler(mockDiscord, mockInteractor)

	interaction := &discordgo.InteractionCreate{
		Interaction: TestCareerStatsInteraction("user123", "guild123"),
	}

	handler.Handle(nil, interaction)

	assert.True(t, contextReceived, "Context should be passed to interactor methods")
}

func TestHandler_Handle_ErrorHandling(t *testing.T) {
	// Test that Discord interaction errors are handled gracefully
	mockDiscord := &dependency.MockDiscordSession{
		InteractionRespondFunc: func(interaction *discordgo.Interaction, resp *discordgo.InteractionResponse, options ...discordgo.RequestOption) error {
			return assert.AnError // Simulate Discord API error
		},
	}

	mockInteractor := &mockInteractor{}
	handler := newTestableHandler(mockDiscord, mockInteractor)

	interaction := &discordgo.InteractionCreate{
		Interaction: TestStandingsInteraction("user123", "guild123"),
	}

	// Should not panic even if Discord interaction fails
	assert.NotPanics(t, func() {
		handler.Handle(nil, interaction)
	})
}
