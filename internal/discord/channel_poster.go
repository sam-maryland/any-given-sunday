package discord

import (
	"context"
	"fmt"
	"time"

	"github.com/bwmarrin/discordgo"
)

// ChannelPoster handles posting messages directly to Discord channels
type ChannelPoster struct {
	session   *discordgo.Session
	channelID string
}

// NewChannelPoster creates a new channel poster for the specified channel
func NewChannelPoster(session *discordgo.Session, channelID string) *ChannelPoster {
	return &ChannelPoster{
		session:   session,
		channelID: channelID,
	}
}

// PostWeeklySummary posts a weekly summary message to the configured Discord channel
func (p *ChannelPoster) PostWeeklySummary(ctx context.Context, summary string) error {
	// Open Discord connection if not already open
	if !p.session.DataReady {
		if err := p.session.Open(); err != nil {
			return fmt.Errorf("failed to open Discord session: %w", err)
		}
		defer p.session.Close()
	}

	// Attempt to send the message with retry logic
	maxRetries := 3
	var lastErr error

	for attempt := 1; attempt <= maxRetries; attempt++ {
		_, err := p.session.ChannelMessageSend(p.channelID, summary)
		if err == nil {
			return nil // Success
		}

		lastErr = err
		if attempt < maxRetries {
			// Wait before retrying (exponential backoff) with context awareness
			waitTime := time.Duration(attempt) * time.Second
			select {
			case <-time.After(waitTime):
				// Continue to the next retry
			case <-ctx.Done():
				return fmt.Errorf("operation canceled: %w", ctx.Err())
			}
		}
	}

	return fmt.Errorf("failed to send message after %d attempts: %w", maxRetries, lastErr)
}
