package discord

import (
	"any-given-sunday/internal/interactor"
	"context"
	"fmt"

	"github.com/bwmarrin/discordgo"
)

// Handler handles Discord events
type Handler struct {
	session    *discordgo.Session
	interactor interactor.Interactor
}

// NewHandler creates a new Handler
func NewHandler(session *discordgo.Session, interactor interactor.Interactor) *Handler {
	return &Handler{
		session:    session,
		interactor: interactor,
	}
}

// Handle handles Discord events
func (h *Handler) Handle(s *discordgo.Session, i *discordgo.InteractionCreate) {
	if i.Type != discordgo.InteractionApplicationCommand {
		return
	}

	ctx := context.Background()

	switch i.ApplicationCommandData().Name {
	case "career-stats":
		h.handleCareerStatsCommand(ctx, s, i)
	}

}

func (h *Handler) handleCareerStatsCommand(ctx context.Context, s *discordgo.Session, i *discordgo.InteractionCreate) {
	options := i.ApplicationCommandData().Options
	var targetUser *discordgo.User
	for _, opt := range options {
		if opt.Type == discordgo.ApplicationCommandOptionUser {
			targetUser = opt.UserValue(s)
			break
		}
	}
	if targetUser == nil {
		return
	}

	member, err := s.GuildMember(i.GuildID, targetUser.ID)
	if err != nil {
		s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseChannelMessageWithSource,
			Data: &discordgo.InteractionResponseData{
				Content: "I couldn't find that user in this server.",
			},
		})
		return
	}

	var displayName string
	if member.Nick != "" {
		displayName = member.Nick
	} else {
		displayName = targetUser.Username
	}

	stats, err := h.interactor.GetCareerStatsForDiscordUser(ctx, targetUser.ID)
	if err != nil {
		s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseChannelMessageWithSource,
			Data: &discordgo.InteractionResponseData{
				Content: fmt.Sprintf("Hmm... I couldn't find any stats for %s.", targetUser.Username),
			},
		})
		return
	}
	s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Content: stats.ToDiscordMessage(displayName),
		},
	})
}
