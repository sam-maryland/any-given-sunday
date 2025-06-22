package discord

import (
	"context"
	"testing"

	"github.com/bwmarrin/discordgo"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewChannelPoster(t *testing.T) {
	session := &discordgo.Session{}
	channelID := "test-channel-id"

	poster := NewChannelPoster(session, channelID)

	assert.NotNil(t, poster)
	assert.Equal(t, session, poster.session)
	assert.Equal(t, channelID, poster.channelID)
}

func TestChannelPoster_PostWeeklySummary_SessionNotReady(t *testing.T) {
	// Create a session with invalid token to trigger a connection error
	session, err := discordgo.New("Bot invalid-token")
	require.NoError(t, err)
	
	poster := NewChannelPoster(session, "test-channel")

	ctx := context.Background()
	err = poster.PostWeeklySummary(ctx, "test message")

	// Should fail since we have an invalid token
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "failed to open Discord session")
}