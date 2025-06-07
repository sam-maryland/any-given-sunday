package discord

import (
	"github.com/bwmarrin/discordgo"
)

// TestInteractionData creates mock interaction data for testing Discord commands
func TestInteractionData(commandName string, options []*discordgo.ApplicationCommandInteractionDataOption) discordgo.ApplicationCommandInteractionData {
	return discordgo.ApplicationCommandInteractionData{
		ID:       "test-interaction-id",
		Name:     commandName,
		Resolved: &discordgo.ApplicationCommandInteractionDataResolved{},
		Options:  options,
	}
}

// TestInteraction creates a mock Discord interaction for testing
func TestInteraction(commandName string, userID string, guildID string, options []*discordgo.ApplicationCommandInteractionDataOption) *discordgo.Interaction {
	return &discordgo.Interaction{
		ID:      "test-interaction-id",
		AppID:   "test-app-id",
		Type:    discordgo.InteractionApplicationCommand,
		GuildID: guildID,
		User: &discordgo.User{
			ID:       userID,
			Username: "testuser",
		},
		Member: &discordgo.Member{
			User: &discordgo.User{
				ID:       userID,
				Username: "testuser",
			},
		},
		Data: TestInteractionData(commandName, options),
	}
}

// TestApplicationCommandOption creates a mock application command option for testing
func TestApplicationCommandOption(name string, optionType discordgo.ApplicationCommandOptionType, value interface{}) *discordgo.ApplicationCommandInteractionDataOption {
	return &discordgo.ApplicationCommandInteractionDataOption{
		Name:  name,
		Type:  optionType,
		Value: value,
	}
}

// TestStringOption creates a string option for Discord command testing
func TestStringOption(name, value string) *discordgo.ApplicationCommandInteractionDataOption {
	return TestApplicationCommandOption(name, discordgo.ApplicationCommandOptionString, value)
}

// TestIntegerOption creates an integer option for Discord command testing
func TestIntegerOption(name string, value int64) *discordgo.ApplicationCommandInteractionDataOption {
	return TestApplicationCommandOption(name, discordgo.ApplicationCommandOptionInteger, value)
}

// TestBooleanOption creates a boolean option for Discord command testing
func TestBooleanOption(name string, value bool) *discordgo.ApplicationCommandInteractionDataOption {
	return TestApplicationCommandOption(name, discordgo.ApplicationCommandOptionBoolean, value)
}

// TestUser creates a mock Discord user for testing
func TestUser(userID, username string) *discordgo.User {
	return &discordgo.User{
		ID:       userID,
		Username: username,
	}
}

// TestMember creates a mock Discord guild member for testing
func TestMember(userID, username, nickname string) *discordgo.Member {
	return &discordgo.Member{
		User: TestUser(userID, username),
		Nick: nickname,
	}
}

// TestCareerStatsInteraction creates a mock interaction for the career-stats command
func TestCareerStatsInteraction(userID, guildID string) *discordgo.Interaction {
	// Create a user option that would contain the target user
	options := []*discordgo.ApplicationCommandInteractionDataOption{
		{
			Name: "user",
			Type: discordgo.ApplicationCommandOptionUser,
			Value: userID,
		},
	}
	
	// Create interaction data with resolved users
	data := TestInteractionData("career-stats", options)
	data.Resolved = &discordgo.ApplicationCommandInteractionDataResolved{
		Users: map[string]*discordgo.User{
			userID: TestUser(userID, "testuser"),
		},
	}
	
	return &discordgo.Interaction{
		ID:      "test-interaction-id",
		AppID:   "test-app-id",
		Type:    discordgo.InteractionApplicationCommand,
		GuildID: guildID,
		User: &discordgo.User{
			ID:       userID,
			Username: "testuser",
		},
		Member: &discordgo.Member{
			User: &discordgo.User{
				ID:       userID,
				Username: "testuser",
			},
		},
		Data: data,
	}
}

// TestStandingsInteraction creates a mock interaction for the standings command
func TestStandingsInteraction(userID, guildID string) *discordgo.Interaction {
	return TestInteraction("standings", userID, guildID, nil)
}

// TestWeeklySummaryInteraction creates a mock interaction for the weekly-summary command
func TestWeeklySummaryInteraction(userID, guildID string, week int64) *discordgo.Interaction {
	options := []*discordgo.ApplicationCommandInteractionDataOption{
		TestIntegerOption("week", week),
	}
	return TestInteraction("weekly-summary", userID, guildID, options)
}