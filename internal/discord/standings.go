package discord

import (
	"context"
	"log"

	"github.com/bwmarrin/discordgo"
)

func (h *Handler) handleStandingsCommand(ctx context.Context, s *discordgo.Session, i *discordgo.InteractionCreate) {
	options := i.ApplicationCommandData().Options
	var year int
	for _, opt := range options {
		if opt.Name == "year" {
			year = int(opt.FloatValue())
			break
		}
	}

	var err error
	if year == 0 {
		year, err = h.interactor.GetLatestLeagueYear(ctx)
		if err != nil {
			log.Printf("error getting latest league year: %v", err)
			s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
				Type: discordgo.InteractionResponseChannelMessageWithSource,
				Data: &discordgo.InteractionResponseData{
					Content: "Hmm... I couldn't get the latest league year." + err.Error(),
				},
			})
			return
		}
	}
	standings, err := h.interactor.GetStandingsForYear(ctx, year)
	if err != nil {
		log.Printf("error getting standings for year [%d]: %v", year, err)
		s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseChannelMessageWithSource,
			Data: &discordgo.InteractionResponseData{
				Content: "Hmm... I couldn't get standings for that year." + err.Error(),
			},
		})
		return
	}
	users, err := h.interactor.GetUsers(ctx)
	if err != nil {
		log.Printf("error getting users: %v", err)
		s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseChannelMessageWithSource,
			Data: &discordgo.InteractionResponseData{
				Content: "Hmm... I couldn't get users." + err.Error(),
			},
		})
		return
	}
	s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Content: standings.ToDiscordMessage(year, users),
		},
	})
}
