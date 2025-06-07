package testutil

import (
	"math/rand/v2"
	"testing"

	"github.com/sam-maryland/any-given-sunday/pkg/types/domain"

	"github.com/google/uuid"
)

func GenerateMatchup(t *testing.T) domain.Matchup {
	playoffRound := uuid.NewString()
	homeSeed := rand.Int()
	awaySeed := rand.Int()
	return domain.Matchup{
		ID:           uuid.NewString(),
		Year:         rand.Int(),
		Week:         rand.Int(),
		IsPlayoff:    rand.Int32()%2 == 0,
		PlayoffRound: &playoffRound,
		HomeUserID:   uuid.NewString(),
		AwayUserID:   uuid.NewString(),
		HomeSeed:     &homeSeed,
		AwaySeed:     &awaySeed,
		HomeScore:    rand.Float64(),
		AwayScore:    rand.Float64(),
	}
}

func GenerateMatchups(t *testing.T, n int) domain.Matchups {
	matchups := make(domain.Matchups, n)
	for i := 0; i < n; i++ {
		matchups[i] = GenerateMatchup(t)
	}
	return matchups
}
