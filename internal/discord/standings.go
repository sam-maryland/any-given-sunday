package discord

import (
	"any-given-sunday/pkg/types"
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
	var league types.League
	if year != 0 {
		league, err = h.interactor.GetLeagueByYear(ctx, year)
	} else {
		league, err = h.interactor.GetLatestLeague(ctx)
	}
	if err != nil {
		log.Printf("error getting league: %v", err)
		if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseChannelMessageWithSource,
			Data: &discordgo.InteractionResponseData{
				Content: "Hmm... I couldn't get the league.",
			},
		}); err != nil {
			log.Printf("error responding to interaction: %s", err.Error())
		}
		return
	}

	standings, err := h.interactor.GetStandingsForLeague(ctx, league)
	if err != nil {
		log.Printf("error getting standings for year [%d]: %v", year, err)
		if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseChannelMessageWithSource,
			Data: &discordgo.InteractionResponseData{
				Content: "Hmm... I couldn't get standings for that year.",
			},
		}); err != nil {
			log.Printf("error responding to interaction: %s", err.Error())
		}
		return
	}

	users, err := h.interactor.GetUsers(ctx)
	if err != nil {
		log.Printf("error getting users: %v", err)
		if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseChannelMessageWithSource,
			Data: &discordgo.InteractionResponseData{
				Content: "Hmm... I couldn't get users.",
			},
		}); err != nil {
			log.Printf("error responding to interaction: %s", err.Error())
		}
		return
	}
	if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Content: standings.ToDiscordMessage(league, users),
		},
	}); err != nil {
		log.Printf("error responding to interaction: %s", err.Error())
	}
}
