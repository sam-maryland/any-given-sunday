package types

import "any-given-sunday/internal/db"

const (
	PlayoffRoundFinals        = "final"
	PlayoffRoundSemifinals    = "semifinal"
	PlayoffRoundQuarterfinals = "quarterfinal"
	PlayoffRoundThirdPlace    = "third_place"
)

type Matchup struct {
	ID           string
	Year         int
	Week         int
	IsPlayoff    bool
	PlayoffRound string
	HomeUserID   string
	AwayUserID   string
	HomeSeed     int
	AwaySeed     int
	HomeScore    float64
	AwayScore    float64
}

func (m Matchup) WinnerAndLoser() (string, string) {
	return m.Winner(), m.Loser()
}

func (m Matchup) Winner() string {
	if m.HomeScore > m.AwayScore {
		return m.HomeUserID
	} else if m.AwayScore > m.HomeScore {
		return m.AwayUserID
	}
	return ""
}

func (m Matchup) Loser() string {
	if m.HomeScore < m.AwayScore {
		return m.HomeUserID
	} else if m.AwayScore < m.HomeScore {
		return m.AwayUserID
	}
	return ""
}

func FromDBMatchup(matchup db.Matchup) Matchup {
	return Matchup{
		ID:           matchup.ID.String(),
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
}

type Matchups []Matchup

func FromDBMatchups(matchups []db.Matchup) Matchups {
	m := make(Matchups, 0, len(matchups))
	for _, matchup := range matchups {
		m = append(m, FromDBMatchup(matchup))
	}
	return m
}
