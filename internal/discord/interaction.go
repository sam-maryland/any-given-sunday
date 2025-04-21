package discord

import (
	"log"

	"github.com/bwmarrin/discordgo"
)

func (h *Handler) Respond(s *discordgo.Session, i *discordgo.InteractionCreate, content string) {
	if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Content: content,
		},
	}); err != nil {
		log.Printf("error responding to interaction: %s", err.Error())
	}
}
