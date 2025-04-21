package discord

import (
	"context"
	"fmt"
	"log"

	"github.com/bwmarrin/discordgo"
)

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
		h.Respond(s, i, "Hmm... I couldn't find that user in this server.")
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
		log.Printf("error querying supabase: %s", err.Error())
		h.Respond(s, i, fmt.Sprintf("Hmm... I couldn't find any status for %s.", targetUser.Username))
		return
	}
	h.Respond(s, i, stats.ToDiscordMessage(displayName))
}
