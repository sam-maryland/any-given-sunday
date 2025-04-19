package testutil

import (
	"any-given-sunday/pkg/types"
	"math/rand/v2"
	"testing"

	"github.com/google/uuid"
)

func GenerateMatchup(t *testing.T) types.Matchup {
	return types.Matchup{
		ID:           uuid.NewString(),
		Year:         rand.Int(),
		Week:         rand.Int(),
		IsPlayoff:    rand.Int32()%2 == 0,
		PlayoffRound: uuid.NewString(),
		HomeUserID:   uuid.NewString(),
		AwayUserID:   uuid.NewString(),
		HomeSeed:     rand.Int(),
		AwaySeed:     rand.Int(),
		HomeScore:    rand.Float64(),
		AwayScore:    rand.Float64(),
	}
}

func GenerateMatchups(t *testing.T, n int) types.Matchups {
	matchups := make(types.Matchups, n)
	for i := 0; i < n; i++ {
		matchups[i] = GenerateMatchup(t)
	}
	return matchups
}
