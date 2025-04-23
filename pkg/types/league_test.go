package types

import (
	"any-given-sunday/pkg/db"
	"math/rand/v2"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
)

func Test_FromDBLeague(t *testing.T) {
	league := db.League{
		ID:          uuid.NewString(),
		Year:        rand.Int32N(10000),
		Status:      uuid.NewString(),
		FirstPlace:  uuid.NewString(),
		SecondPlace: uuid.NewString(),
		ThirdPlace:  uuid.NewString(),
	}

	expected := League{
		ID:          league.ID,
		Year:        int(league.Year),
		Status:      league.Status,
		FirstPlace:  league.FirstPlace,
		SecondPlace: league.SecondPlace,
		ThirdPlace:  league.ThirdPlace,
	}

	assert.Equal(t, expected, FromDBLeague(league))
}
