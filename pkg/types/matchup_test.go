package types

import (
	"any-given-sunday/pkg/db"
	"math/rand/v2"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
)

func Test_FromDBMatchup(t *testing.T) {
	var id pgtype.UUID
	err := id.Scan(uuid.NewString())
	assert.NoError(t, err)

	matchup := db.Matchup{
		ID:           id,
		Year:         rand.Int32(),
		Week:         rand.Int32(),
		IsPlayoff:    pgtype.Bool{Bool: rand.Int32()%2 == 0},
		PlayoffRound: pgtype.Text{String: uuid.NewString()},
		HomeUserID:   uuid.NewString(),
		AwayUserID:   uuid.NewString(),
		HomeSeed:     pgtype.Int4{Int32: rand.Int32()},
		AwaySeed:     pgtype.Int4{Int32: rand.Int32()},
		HomeScore:    rand.Float64(),
		AwayScore:    rand.Float64(),
	}

	expected := Matchup{
		ID:           id.String(),
		Year:         int(matchup.Year),
		Week:         int(matchup.Week),
		IsPlayoff:    matchup.IsPlayoff.Bool,
		PlayoffRound: matchup.PlayoffRound.String,
		HomeUserID:   matchup.HomeUserID,
		AwayUserID:   matchup.AwayUserID,
		HomeSeed:     int(matchup.HomeSeed.Int32),
		AwaySeed:     int(matchup.AwaySeed.Int32),
		HomeScore:    matchup.HomeScore,
		AwayScore:    matchup.AwayScore,
	}

	assert.Equal(t, expected, FromDBMatchup(matchup))
}

func Test_Matchup_Winner_Loser(t *testing.T) {
	m := Matchup{
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
	if m.HomeScore > m.AwayScore {
		assert.Equal(t, m.HomeUserID, m.Winner())
		assert.Equal(t, m.AwayUserID, m.Loser())
	}
	if m.AwayScore > m.HomeScore {
		assert.Equal(t, m.AwayUserID, m.Winner())
		assert.Equal(t, m.HomeUserID, m.Loser())
	}
	if m.AwayScore == m.HomeScore {
		assert.Empty(t, m.Winner())
		assert.Empty(t, m.Loser())
	}
}
