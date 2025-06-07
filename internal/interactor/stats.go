package interactor

import (
	"context"

	"github.com/sam-maryland/any-given-sunday/pkg/types/converters"
	"github.com/sam-maryland/any-given-sunday/pkg/types/domain"
)

type StatsInteractor interface {
	GetCareerStatsForDiscordUser(ctx context.Context, userID string) (domain.CareerStats, error)
}

func (i *interactor) GetCareerStatsForDiscordUser(ctx context.Context, userID string) (domain.CareerStats, error) {
	stat, err := i.DB.GetCareerStatsByDiscordID(ctx, userID)
	if err != nil {
		return domain.CareerStats{}, err
	}

	return converters.CareerStatsFromDB(stat), nil
}
