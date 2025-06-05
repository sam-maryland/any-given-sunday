package types

import (
	"fmt"
	"math/rand/v2"
	"testing"

	"github.com/sam-maryland/any-given-sunday/pkg/config"
	"github.com/sam-maryland/any-given-sunday/pkg/db"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
)

func Test_FromDBCareerStat(t *testing.T) {
	stat := db.CareerStat{
		UserID:                     uuid.NewString(),
		UserName:                   uuid.NewString(),
		DiscordID:                  uuid.NewString(),
		SeasonsPlayed:              rand.Int64(),
		RegularSeasonWins:          rand.Int32(),
		RegularSeasonLosses:        rand.Int32(),
		RegularSeasonAvgPoints:     rand.Float64(),
		RegularSeasonPointsFor:     rand.Float64(),
		RegularSeasonPointsAgainst: rand.Float64(),
		HighestRegularSeasonScore:  rand.Float64(),
		WeeklyHighScores:           rand.Int64(),
		PlayoffAppearances:         rand.Int64(),
		PlayoffWins:                rand.Int32(),
		PlayoffLosses:              rand.Int32(),
		QuarterfinalAppearances:    rand.Int64(),
		SemifinalAppearances:       rand.Int64(),
		FinalsAppearances:          rand.Int64(),
		FirstPlaceFinishes:         rand.Int64(),
		SecondPlaceFinishes:        rand.Int64(),
		ThirdPlaceFinishes:         rand.Int64(),
		PlayoffPointsFor:           rand.Float64(),
		PlayoffPointsAgainst:       rand.Float64(),
		PlayoffAvgPoints:           rand.Float64(),
	}

	expected := CareerStats{
		UserID:                     stat.UserID,
		UserName:                   stat.UserName,
		SeasonsPlayed:              stat.SeasonsPlayed,
		RegularSeasonRecord:        fmt.Sprintf("%d-%d", stat.RegularSeasonWins, stat.RegularSeasonLosses),
		RegularSeasonAvgPoints:     stat.RegularSeasonAvgPoints,
		RegularSeasonPointsFor:     stat.RegularSeasonPointsFor.(float64),
		RegularSeasonPointsAgainst: stat.RegularSeasonPointsAgainst.(float64),
		HighestRegularSeasonScore:  stat.HighestRegularSeasonScore,
		WeeklyHighScores:           stat.WeeklyHighScores,
		PlayoffAppearances:         stat.PlayoffAppearances,
		PlayoffRecord:              fmt.Sprintf("%d-%d", stat.PlayoffWins, stat.PlayoffLosses),
		QuarterfinalAppearances:    stat.QuarterfinalAppearances,
		SemifinalAppearances:       stat.SemifinalAppearances,
		FinalsAppearances:          stat.FinalsAppearances,
		FirstPlaceFinishes:         stat.FirstPlaceFinishes,
		SecondPlaceFinishes:        stat.SecondPlaceFinishes,
		ThirdPlaceFinishes:         stat.ThirdPlaceFinishes,
		PlayoffPointsFor:           stat.PlayoffPointsFor.(float64),
		PlayoffPointsAgainst:       stat.PlayoffPointsAgainst.(float64),
		PlayoffAvgPoints:           stat.PlayoffAvgPoints.(float64),
	}

	assert.Equal(t, expected, FromDBCareerStat(stat))
}

func Test_CareerStats_CalculateCareerEarnings(t *testing.T) {
	stat := CareerStats{
		SeasonsPlayed:       rand.Int64(),
		WeeklyHighScores:    rand.Int64(),
		FirstPlaceFinishes:  rand.Int64(),
		SecondPlaceFinishes: rand.Int64(),
		ThirdPlaceFinishes:  rand.Int64(),
	}

	expected := -(int(stat.SeasonsPlayed) * config.PayInBuyIn) +
		int(stat.WeeklyHighScores)*config.PayOutWeeklyHighScore +
		int(stat.FirstPlaceFinishes)*config.PayOutFirstPlace +
		int(stat.SecondPlaceFinishes)*config.PayOutSecondPlace +
		int(stat.ThirdPlaceFinishes)*config.PayOutThirdPlace

	assert.Equal(t, expected, stat.CalculateCareerEarnings())
}
