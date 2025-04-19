package interactor

import (
	"any-given-sunday/pkg/types"
	"context"
)

type StatsInteractor interface {
	GetCareerStatsForDiscordUser(ctx context.Context, userID string) (types.CareerStats, error)
}

func (i *interactor) GetCareerStatsForDiscordUser(ctx context.Context, userID string) (types.CareerStats, error) {
	stat, err := i.Queries.GetCareerStatsByDiscordID(ctx, userID)
	if err != nil {
		return types.CareerStats{}, err
	}

	return types.FromCareerStatRow(stat), nil
}
