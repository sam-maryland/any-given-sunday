package discord

import (
	"context"
	"fmt"
	"log"

	"github.com/sam-maryland/any-given-sunday/internal/interactor"
	"github.com/sam-maryland/any-given-sunday/pkg/config"

	"github.com/bwmarrin/discordgo"
)

const (
	componentIDSleeperUserSelect = "sleeper_user_select"
)

// OnGuildMemberAdd handles when new users join the Discord server
func (h *Handler) OnGuildMemberAdd(s *discordgo.Session, m *discordgo.GuildMemberAdd) {
	// Skip if user is a bot
	if m.User.Bot {
		return
	}

	ctx := context.Background()

	// Check if user is already onboarded
	isOnboarded, err := h.interactor.IsUserOnboarded(ctx, m.User.ID)
	if err != nil {
		log.Printf("Error checking onboarding status for user %s: %v", m.User.ID, err)
		return
	}

	if isOnboarded {
		log.Printf("User %s (%s) already onboarded, skipping welcome message", m.User.Username, m.User.ID)
		return
	}

	// Send welcome message
	err = h.sendWelcomeMessage(ctx, s, m.User)
	if err != nil {
		log.Printf("Error sending welcome message to user %s: %v", m.User.ID, err)
	}
}

// sendWelcomeMessage creates and sends the onboarding welcome message with Sleeper user selection
func (h *Handler) sendWelcomeMessage(ctx context.Context, s *discordgo.Session, user *discordgo.User) error {
	// Get available Sleeper users
	availableUsers, err := h.interactor.GetAvailableSleeperUsers(ctx)
	if err != nil {
		return fmt.Errorf("failed to get available Sleeper users: %w", err)
	}

	if len(availableUsers) == 0 {
		// No available users - send message indicating all accounts are claimed
		return h.sendNoAvailableUsersMessage(s, user)
	}

	// Create select menu with available Sleeper users
	selectMenu := h.createSleeperUserSelectMenu(availableUsers)

	// Create welcome message content
	content := fmt.Sprintf(
		"<@%s> **Welcome to the Any Given Sunday Discord!** 🏈\n\n"+
			"To get started and use the bot commands, please select your Sleeper account from the dropdown below. "+
			"This links your Discord account to your fantasy team.\n\n"+
			"**Choose your Sleeper account:**",
		user.ID,
	)

	// Get welcome channel ID from config
	cfg := config.InitConfig() // You might want to pass this through dependency injection
	welcomeChannelID := cfg.WelcomeChannelID

	// Send message to welcome channel
	_, err = s.ChannelMessageSendComplex(welcomeChannelID, &discordgo.MessageSend{
		Content: content,
		Components: []discordgo.MessageComponent{
			discordgo.ActionsRow{
				Components: []discordgo.MessageComponent{selectMenu},
			},
		},
	})

	if err != nil {
		return fmt.Errorf("failed to send welcome message: %w", err)
	}

	log.Printf("Sent welcome message to user %s (%s) with %d available Sleeper accounts",
		user.Username, user.ID, len(availableUsers))

	return nil
}

// createSleeperUserSelectMenu creates a Discord select menu with available Sleeper users
func (h *Handler) createSleeperUserSelectMenu(users []interactor.AvailableSleeperUser) *discordgo.SelectMenu {
	options := make([]discordgo.SelectMenuOption, len(users))

	for i, user := range users {
		// Create display label: "John Smith (johnsmith123) - Team: The Dynasty Kings"
		label := fmt.Sprintf("%s (%s)", user.DisplayName, user.Username)
		if len(label) > 80 { // Discord has a 100 char limit, leave room for team name
			label = label[:77] + "..."
		}

		description := ""
		if user.TeamName != "" {
			description = fmt.Sprintf("Team: %s", user.TeamName)
			if len(description) > 100 { // Discord description limit
				description = description[:97] + "..."
			}
		}

		options[i] = discordgo.SelectMenuOption{
			Label:       label,
			Value:       user.SleeperUserID,
			Description: description,
		}
	}

	return &discordgo.SelectMenu{
		CustomID:    componentIDSleeperUserSelect,
		Placeholder: "Select your Sleeper account...",
		MinValues:   &[]int{1}[0],
		MaxValues:   1,
		Options:     options,
	}
}

// sendNoAvailableUsersMessage sends a message when all Sleeper accounts are already claimed
func (h *Handler) sendNoAvailableUsersMessage(s *discordgo.Session, user *discordgo.User) error {
	cfg := config.InitConfig()
	welcomeChannelID := cfg.WelcomeChannelID

	content := fmt.Sprintf(
		"<@%s> **Welcome to the dynasty league Discord!** 🏈\n\n"+
			"Unfortunately, all Sleeper accounts have already been claimed by other Discord users. "+
			"Please contact a league administrator if you believe this is an error or if you need assistance "+
			"linking your account manually.",
		user.ID,
	)

	_, err := s.ChannelMessageSend(welcomeChannelID, content)
	if err != nil {
		return fmt.Errorf("failed to send no available users message: %w", err)
	}

	log.Printf("Sent 'no available users' message to user %s (%s)", user.Username, user.ID)
	return nil
}

// HandleComponentInteraction processes Discord component interactions (like select menu selections)
func (h *Handler) HandleComponentInteraction(s *discordgo.Session, i *discordgo.InteractionCreate) {
	if i.Type != discordgo.InteractionMessageComponent {
		return
	}

	data := i.MessageComponentData()
	ctx := context.Background()

	switch data.CustomID {
	case componentIDSleeperUserSelect:
		h.handleSleeperUserSelection(ctx, s, i, data)
	default:
		log.Printf("Unknown component interaction: %s", data.CustomID)
	}
}

// handleSleeperUserSelection processes when a user selects their Sleeper account
func (h *Handler) handleSleeperUserSelection(ctx context.Context, s *discordgo.Session, i *discordgo.InteractionCreate, data discordgo.MessageComponentInteractionData) {
	if len(data.Values) == 0 {
		h.respondWithError(s, i, "No Sleeper account selected. Please try again.")
		return
	}

	selectedSleeperUserID := data.Values[0]
	discordUserID := i.Member.User.ID

	// Attempt to link the accounts
	err := h.interactor.LinkDiscordToSleeperUser(ctx, discordUserID, selectedSleeperUserID)
	if err != nil {
		log.Printf("Failed to link Discord user %s to Sleeper user %s: %v", discordUserID, selectedSleeperUserID, err)
		h.respondWithError(s, i, fmt.Sprintf("Failed to link accounts: %s", err.Error()))
		return
	}

	// Success - update the message to show completion
	err = s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseUpdateMessage,
		Data: &discordgo.InteractionResponseData{
			Content: fmt.Sprintf(
				"✅ **Successfully linked your Discord account!**\n\n"+
					"<@%s>, you can now use all bot commands like `/career-stats` and `/standings`. "+
					"Welcome to the league! 🏈",
				discordUserID,
			),
			Components: []discordgo.MessageComponent{}, // Remove the select menu
		},
	})

	if err != nil {
		log.Printf("Failed to update welcome message after successful linking: %v", err)
	} else {
		log.Printf("Successfully linked Discord user %s to Sleeper user %s", discordUserID, selectedSleeperUserID)
	}
}

// respondWithError sends an error response to a Discord interaction
func (h *Handler) respondWithError(s *discordgo.Session, i *discordgo.InteractionCreate, message string) {
	err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Content: fmt.Sprintf("❌ **Error:** %s", message),
			Flags:   discordgo.MessageFlagsEphemeral, // Only visible to the user
		},
	})

	if err != nil {
		log.Printf("Failed to send error response: %v", err)
	}
}
