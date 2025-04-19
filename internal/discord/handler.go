package discord

import (
	"any-given-sunday/internal/interactor"
	"context"

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
	case "standings":
		h.handleStandingsCommand(ctx, s, i)
	}

}
