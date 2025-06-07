package domain

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
	PlayoffRound *string  // Nullable
	HomeUserID   string
	AwayUserID   string
	HomeSeed     *int     // Nullable
	AwaySeed     *int     // Nullable
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

type Matchups []Matchup
