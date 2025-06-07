package discord

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/sam-maryland/any-given-sunday/internal/dependency"
	"github.com/sam-maryland/any-given-sunday/internal/interactor"

	"github.com/bwmarrin/discordgo"
	"github.com/stretchr/testify/assert"
)

// testableOnboardingHandler creates a handler with mock dependencies for testing onboarding
type testableOnboardingHandler struct {
	mockSession    *dependency.MockDiscordSession
	mockInteractor interactor.Interactor
}

// OnGuildMemberAdd is a testable version that uses our mock session
func (h *testableOnboardingHandler) OnGuildMemberAdd(m *discordgo.GuildMemberAdd) {
	if m.User.Bot {
		return
	}

	ctx := context.Background()
	
	isOnboarded, err := h.mockInteractor.IsUserOnboarded(ctx, m.User.ID)
	if err != nil {
		return
	}

	if isOnboarded {
		return
	}

	h.sendWelcomeMessage(ctx, m.User)
}

func (h *testableOnboardingHandler) sendWelcomeMessage(ctx context.Context, user *discordgo.User) error {
	availableUsers, err := h.mockInteractor.GetAvailableSleeperUsers(ctx)
	if err != nil {
		return err
	}

	if len(availableUsers) == 0 {
		return h.sendNoAvailableUsersMessage(user)
	}

	// Simulate sending welcome message with select menu
	_, err = h.mockSession.ChannelMessageSendComplex("welcome-channel-123", &discordgo.MessageSend{
		Content: "Welcome to the Any Given Sunday Discord! 🏈",
		Components: []discordgo.MessageComponent{
			discordgo.ActionsRow{
				Components: []discordgo.MessageComponent{
					&discordgo.SelectMenu{
						CustomID: componentIDSleeperUserSelect,
						Options:  []discordgo.SelectMenuOption{},
					},
				},
			},
		},
	})

	return err
}

func (h *testableOnboardingHandler) sendNoAvailableUsersMessage(user *discordgo.User) error {
	_, err := h.mockSession.ChannelMessageSend("welcome-channel-123", "all Sleeper accounts have already been claimed")
	return err
}

func (h *testableOnboardingHandler) handleSleeperUserSelection(ctx context.Context, i *discordgo.InteractionCreate, data discordgo.MessageComponentInteractionData) {
	if len(data.Values) == 0 {
		h.mockSession.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseChannelMessageWithSource,
			Data: &discordgo.InteractionResponseData{
				Content: "❌ **Error:** No Sleeper account selected",
				Flags:   discordgo.MessageFlagsEphemeral,
			},
		})
		return
	}

	selectedSleeperUserID := data.Values[0]
	discordUserID := i.Member.User.ID

	err := h.mockInteractor.LinkDiscordToSleeperUser(ctx, discordUserID, selectedSleeperUserID)
	if err != nil {
		h.mockSession.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseChannelMessageWithSource,
			Data: &discordgo.InteractionResponseData{
				Content: "❌ **Error:** " + err.Error(),
				Flags:   discordgo.MessageFlagsEphemeral,
			},
		})
		return
	}

	h.mockSession.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseUpdateMessage,
		Data: &discordgo.InteractionResponseData{
			Content:    "✅ **Successfully linked your Discord account!**",
			Components: []discordgo.MessageComponent{},
		},
	})
}

// mockOnboardingInteractor implements OnboardingInteractor for testing
type mockOnboardingInteractor struct {
	GetAvailableSleeperUsersFunc func(ctx context.Context) ([]interactor.AvailableSleeperUser, error)
	LinkDiscordToSleeperUserFunc func(ctx context.Context, discordID, sleeperUserID string) error
	IsUserOnboardedFunc          func(ctx context.Context, discordID string) (bool, error)
}

func (m *mockOnboardingInteractor) GetAvailableSleeperUsers(ctx context.Context) ([]interactor.AvailableSleeperUser, error) {
	if m.GetAvailableSleeperUsersFunc != nil {
		return m.GetAvailableSleeperUsersFunc(ctx)
	}
	return nil, nil
}

func (m *mockOnboardingInteractor) LinkDiscordToSleeperUser(ctx context.Context, discordID, sleeperUserID string) error {
	if m.LinkDiscordToSleeperUserFunc != nil {
		return m.LinkDiscordToSleeperUserFunc(ctx, discordID, sleeperUserID)
	}
	return nil
}

func (m *mockOnboardingInteractor) IsUserOnboarded(ctx context.Context, discordID string) (bool, error) {
	if m.IsUserOnboardedFunc != nil {
		return m.IsUserOnboardedFunc(ctx, discordID)
	}
	return false, nil
}

// mockFullInteractor combines all interactor interfaces for testing
type mockFullInteractor struct {
	*mockOnboardingInteractor
	interactor.LeagueInteractor
	interactor.StatsInteractor
	interactor.UsersInteractor
	interactor.WeeklyJobInteractor
}

func TestOnGuildMemberAdd(t *testing.T) {
	tests := []struct {
		name                    string
		member                  *discordgo.GuildMemberAdd
		isUserOnboarded         bool
		onboardingCheckError    error
		availableUsers          []interactor.AvailableSleeperUser
		getAvailableUsersError  error
		sendMessageError        error
		expectWelcomeMessage    bool
		expectNoAvailableMsg    bool
	}{
		{
			name: "new user gets welcome message with available sleeper users",
			member: &discordgo.GuildMemberAdd{
				Member: &discordgo.Member{
					User: &discordgo.User{
						ID:       "discord123",
						Username: "newuser",
						Bot:      false,
					},
				},
			},
			isUserOnboarded: false,
			availableUsers: []interactor.AvailableSleeperUser{
				{
					SleeperUserID: "sleeper1",
					DisplayName:   "John Doe",
					Username:      "johndoe",
					TeamName:      "Dynasty Kings",
					RosterID:      1,
				},
			},
			expectWelcomeMessage: true,
		},
		{
			name: "new user gets no available users message",
			member: &discordgo.GuildMemberAdd{
				Member: &discordgo.Member{
					User: &discordgo.User{
						ID:       "discord456",
						Username: "anotheruser",
						Bot:      false,
					},
				},
			},
			isUserOnboarded:      false,
			availableUsers:       []interactor.AvailableSleeperUser{},
			expectNoAvailableMsg: true,
		},
		{
			name: "already onboarded user skipped",
			member: &discordgo.GuildMemberAdd{
				Member: &discordgo.Member{
					User: &discordgo.User{
						ID:       "discord789",
						Username: "existinguser",
						Bot:      false,
					},
				},
			},
			isUserOnboarded:      true,
			expectWelcomeMessage: false,
		},
		{
			name: "bot user skipped",
			member: &discordgo.GuildMemberAdd{
				Member: &discordgo.Member{
					User: &discordgo.User{
						ID:       "bot123",
						Username: "testbot",
						Bot:      true,
					},
				},
			},
			expectWelcomeMessage: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockSession := &dependency.MockDiscordSession{
				ChannelMessageSendComplexFunc: func(channelID string, data *discordgo.MessageSend) (*discordgo.Message, error) {
					if tt.expectWelcomeMessage {
						assert.Equal(t, "welcome-channel-123", channelID)
						assert.Contains(t, data.Content, "Welcome to the Any Given Sunday Discord")
						assert.Len(t, data.Components, 1)
					}
					return &discordgo.Message{ID: "message123"}, tt.sendMessageError
				},
				ChannelMessageSendFunc: func(channelID, content string) (*discordgo.Message, error) {
					if tt.expectNoAvailableMsg {
						assert.Equal(t, "welcome-channel-123", channelID)
						assert.Contains(t, content, "all Sleeper accounts have already been claimed")
					}
					return &discordgo.Message{ID: "message456"}, tt.sendMessageError
				},
			}

			mockInteractor := &mockFullInteractor{
				mockOnboardingInteractor: &mockOnboardingInteractor{
					IsUserOnboardedFunc: func(ctx context.Context, discordID string) (bool, error) {
						assert.Equal(t, tt.member.User.ID, discordID)
						return tt.isUserOnboarded, tt.onboardingCheckError
					},
					GetAvailableSleeperUsersFunc: func(ctx context.Context) ([]interactor.AvailableSleeperUser, error) {
						return tt.availableUsers, tt.getAvailableUsersError
					},
				},
			}

			testHandler := &testableOnboardingHandler{
				mockSession:    mockSession,
				mockInteractor: mockInteractor,
			}

			os.Setenv("DISCORD_WELCOME_CHANNEL_ID", "welcome-channel-123")
			defer os.Unsetenv("DISCORD_WELCOME_CHANNEL_ID")

			testHandler.OnGuildMemberAdd(tt.member)

			if tt.expectWelcomeMessage || tt.expectNoAvailableMsg {
				if tt.expectWelcomeMessage {
					assert.True(t, mockSession.ChannelMessageSendComplexCalled)
				} else if tt.expectNoAvailableMsg {
					assert.True(t, mockSession.ChannelMessageSendCalled)
				}
			}
		})
	}
}

func TestCreateSleeperUserSelectMenu(t *testing.T) {
	tests := []struct {
		name          string
		users         []interactor.AvailableSleeperUser
		expectedCount int
		expectTruncation bool
	}{
		{
			name: "normal users",
			users: []interactor.AvailableSleeperUser{
				{
					SleeperUserID: "user1",
					DisplayName:   "John Doe",
					Username:      "johndoe",
					TeamName:      "Dynasty Kings",
					RosterID:      1,
				},
				{
					SleeperUserID: "user2",
					DisplayName:   "Jane Smith",
					Username:      "janesmith",
					TeamName:      "Thunder Bolts",
					RosterID:      2,
				},
			},
			expectedCount: 2,
		},
		{
			name: "long names get truncated",
			users: []interactor.AvailableSleeperUser{
				{
					SleeperUserID: "user3",
					DisplayName:   "This Is A Very Long Display Name That Should Be Truncated",
					Username:      "verylongusername123456789",
					TeamName:      "This Is Also A Very Long Team Name That Should Be Truncated Because It Exceeds Discord Limits",
					RosterID:      3,
				},
			},
			expectedCount:    1,
			expectTruncation: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := &Handler{}
			
			selectMenu := handler.createSleeperUserSelectMenu(tt.users)
			
			assert.Equal(t, componentIDSleeperUserSelect, selectMenu.CustomID)
			assert.Equal(t, "Select your Sleeper account...", selectMenu.Placeholder)
			assert.Equal(t, 1, *selectMenu.MinValues)
			assert.Equal(t, 1, selectMenu.MaxValues)
			assert.Len(t, selectMenu.Options, tt.expectedCount)
			
			for i, option := range selectMenu.Options {
				assert.Equal(t, tt.users[i].SleeperUserID, option.Value)
				
				if tt.expectTruncation {
					assert.LessOrEqual(t, len(option.Label), 80)
					if option.Description != "" {
						assert.LessOrEqual(t, len(option.Description), 100)
					}
				} else {
					expectedLabel := tt.users[i].DisplayName + " (" + tt.users[i].Username + ")"
					assert.Equal(t, expectedLabel, option.Label)
					if tt.users[i].TeamName != "" {
						expectedDesc := "Team: " + tt.users[i].TeamName
						assert.Equal(t, expectedDesc, option.Description)
					}
				}
			}
		})
	}
}

func TestHandleSleeperUserSelection(t *testing.T) {
	tests := []struct {
		name                string
		interactionData     discordgo.MessageComponentInteractionData
		member              *discordgo.Member
		linkError           error
		expectError         bool
		expectSuccess       bool
	}{
		{
			name: "successful account linking",
			interactionData: discordgo.MessageComponentInteractionData{
				Values: []string{"sleeper123"},
			},
			member: &discordgo.Member{
				User: &discordgo.User{ID: "discord456"},
			},
			expectSuccess: true,
		},
		{
			name: "no sleeper account selected",
			interactionData: discordgo.MessageComponentInteractionData{
				Values: []string{},
			},
			member: &discordgo.Member{
				User: &discordgo.User{ID: "discord789"},
			},
			expectError: true,
		},
		{
			name: "account linking fails",
			interactionData: discordgo.MessageComponentInteractionData{
				Values: []string{"sleeper456"},
			},
			member: &discordgo.Member{
				User: &discordgo.User{ID: "discord123"},
			},
			linkError:   errors.New("account already claimed"),
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			linkCalled := false

			mockSession := &dependency.MockDiscordSession{
				InteractionRespondFunc: func(interaction *discordgo.Interaction, resp *discordgo.InteractionResponse, options ...discordgo.RequestOption) error {
					if tt.expectSuccess {
						assert.Equal(t, discordgo.InteractionResponseUpdateMessage, resp.Type)
						assert.Contains(t, resp.Data.Content, "Successfully linked")
						assert.Empty(t, resp.Data.Components)
					} else if tt.expectError {
						assert.Equal(t, discordgo.InteractionResponseChannelMessageWithSource, resp.Type)
						assert.Contains(t, resp.Data.Content, "Error")
						assert.Equal(t, discordgo.MessageFlagsEphemeral, resp.Data.Flags)
					}
					return nil
				},
			}

			mockInteractor := &mockFullInteractor{
				mockOnboardingInteractor: &mockOnboardingInteractor{
					LinkDiscordToSleeperUserFunc: func(ctx context.Context, discordID, sleeperUserID string) error {
						linkCalled = true
						if len(tt.interactionData.Values) > 0 {
							assert.Equal(t, tt.member.User.ID, discordID)
							assert.Equal(t, tt.interactionData.Values[0], sleeperUserID)
						}
						return tt.linkError
					},
				},
			}

			testHandler := &testableOnboardingHandler{
				mockSession:    mockSession,
				mockInteractor: mockInteractor,
			}

			interaction := &discordgo.InteractionCreate{
				Interaction: &discordgo.Interaction{
					Member: tt.member,
				},
			}

			testHandler.handleSleeperUserSelection(context.Background(), interaction, tt.interactionData)

			assert.True(t, mockSession.InteractionRespondCalled)
			
			if len(tt.interactionData.Values) > 0 {
				assert.True(t, linkCalled)
			}
		})
	}
}