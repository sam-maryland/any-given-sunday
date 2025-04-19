package types

import (
	"testing"

	"github.com/google/go-cmp/cmp"

	"github.com/google/uuid"
)

func Test_MatchupsToStandingsMap(t *testing.T) {
	ms := Matchups{
		{
			ID:        uuid.NewString(),
			IsPlayoff: true,
		},
		{
			ID:         uuid.NewString(),
			HomeUserID: "1",
			AwayUserID: "2",
			HomeScore:  10,
			AwayScore:  5,
		},
		{
			ID:         uuid.NewString(),
			HomeUserID: "1",
			AwayUserID: "3",
			HomeScore:  20,
			AwayScore:  15,
		},
		{
			ID:         uuid.NewString(),
			HomeUserID: "2",
			AwayUserID: "3",
			HomeScore:  30,
			AwayScore:  25,
		},
		{
			ID:         uuid.NewString(),
			HomeUserID: "1",
			AwayUserID: "2",
			HomeScore:  15,
			AwayScore:  30,
		},
	}

	expected := StandingsMap{
		"1": {
			UserID:        "1",
			Wins:          2,
			Losses:        1,
			Ties:          0,
			PointsFor:     45,
			PointsAgainst: 50,
			H2HWins:       map[string]int{"2": 1, "3": 1},
		},
		"2": {
			UserID:        "2",
			Wins:          2,
			Losses:        1,
			Ties:          0,
			PointsFor:     65,
			PointsAgainst: 50,
			H2HWins:       map[string]int{"1": 1, "3": 1},
		},
		"3": {
			UserID:        "3",
			Wins:          0,
			Losses:        2,
			Ties:          0,
			PointsFor:     40,
			PointsAgainst: 50,
			H2HWins:       map[string]int{},
		},
	}

	if diff := cmp.Diff(expected, MatchupsToStandingsMap(ms)); diff != "" {
		t.Errorf("mismatch (-want +got):\n%s", diff)
	}
}

func Test_SortStandingsMap(t *testing.T) {
	standings := StandingsMap{
		"1": {
			UserID:        "1",
			Wins:          8,
			Losses:        4,
			Ties:          0,
			PointsFor:     1808.65,
			PointsAgainst: 1544.05,
			H2HWins:       map[string]int{},
		},
		"2": {
			UserID:        "2",
			Wins:          2,
			Losses:        10,
			Ties:          0,
			PointsFor:     1552.05,
			PointsAgainst: 1731.15,
			H2HWins:       map[string]int{},
		},
		"3": {
			UserID:        "3",
			Wins:          6,
			Losses:        6,
			Ties:          0,
			PointsFor:     1495.05,
			PointsAgainst: 1596.55,
			H2HWins: map[string]int{
				"5": 1,
			},
		},
		"4": {
			UserID:        "4",
			Wins:          6,
			Losses:        6,
			Ties:          0,
			PointsFor:     1584.10,
			PointsAgainst: 1676.55,
			H2HWins: map[string]int{
				"3": 1,
			},
		},
		"5": {
			UserID:        "5",
			Wins:          6,
			Losses:        6,
			Ties:          0,
			PointsFor:     1584.10,
			PointsAgainst: 1676.55,
			H2HWins:       map[string]int{},
		},
	}

	expected := Standings{
		standings["1"],
		standings["4"],
		standings["3"],
		standings["5"],
		standings["2"],
	}

	if diff := cmp.Diff(expected, standings.SortStandingsMap()); diff != "" {
		t.Errorf("mismatch (-want +got):\n%s", diff)
	}
}
