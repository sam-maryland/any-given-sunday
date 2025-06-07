package discord

import (
	"context"
	"log"

	"github.com/sam-maryland/any-given-sunday/pkg/types/domain"

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
	var league domain.League
	if year != 0 {
		league, err = h.interactor.GetLeagueByYear(ctx, year)
	} else {
		league, err = h.interactor.GetLatestLeague(ctx)
	}
	if err != nil {
		log.Printf("error getting league: %v", err)
		h.Respond(s, i, "Hmm... I couldn't get the league.")
		return
	}

	standings, err := h.interactor.GetStandingsForLeague(ctx, league)
	if err != nil {
		log.Printf("error getting standings for year [%d]: %v", year, err)
		h.Respond(s, i, "Hmm... I couldn't get the standings.")
		return
	}

	users, err := h.interactor.GetUsers(ctx)
	if err != nil {
		log.Printf("error getting users: %v", err)
		h.Respond(s, i, "Hmm... I couldn't get users.")
		return
	}
	h.Respond(s, i, standings.ToDiscordMessage(league, users))
}
