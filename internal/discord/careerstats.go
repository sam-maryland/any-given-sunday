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
		if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseChannelMessageWithSource,
			Data: &discordgo.InteractionResponseData{
				Content: "I couldn't find that user in this server.",
			},
		}); err != nil {
			log.Printf("error responding to interaction: %s", err.Error())
		}
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
		if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseChannelMessageWithSource,
			Data: &discordgo.InteractionResponseData{
				Content: fmt.Sprintf("Hmm... I couldn't find any stats for %s.", targetUser.Username),
			},
		}); err != nil {
			log.Printf("error responding to interaction: %s", err.Error())
		}
		return
	}
	if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Content: stats.ToDiscordMessage(displayName),
		},
	}); err != nil {
		log.Printf("error responding to interaction: %s", err.Error())
	}
}
