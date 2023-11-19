package discord

import (
	"context"
	"log"

	"github.com/bwmarrin/discordgo"
)

type IDiscordClient interface {
	SendMessage(ctx context.Context, message string) error
}

type DiscordClient struct {
	Session *discordgo.Session
	UserID  string
}

func NewDiscordClient(bt string, uid string) *DiscordClient {
	dc := &DiscordClient{}

	s, err := discordgo.New("Bot " + bt)
	if err != nil {
		log.Fatalf("error creating discord session: %v", err)
	}
	s.Identify.Intents = discordgo.IntentDirectMessages
	dc.Session = s

	dc.UserID = uid

	return dc
}

func (c *DiscordClient) SendMessage(ctx context.Context, message string) error {
	channel, err := c.Session.UserChannelCreate(c.UserID)
	if err != nil {
		return err
	}

	_, err = c.Session.ChannelMessageSend(channel.ID, message)
	if err != nil {
		return err
	}

	return nil
}
