package types

type Matchup struct {
	ID             int                `json:"matchup_id"`
	RosterID       int                `json:"roster_id"`
	PlayersPoints  map[string]float32 `json:"players_points"`
	StartersPoints []float32          `json:"starters_points"`
	Starters       []string           `json:"starters"`
	Players        []string           `json:"players"`
	Points         float32            `json:"points"`
}

type Matchups []Matchup

func (ms Matchups) WithMaxPoints() Matchup {
	var h Matchup
	for _, m := range ms {
		if m.Points > h.Points {
			h = m
		}
	}
	return h
}
