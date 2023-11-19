package types

import "sort"

type Roster struct {
	ID       int            `json:"roster_id"`
	Players  []string       `json:"players"`
	Starters []string       `json:"starters"`
	Reserve  []string       `json:"reserve"`
	Taxi     []string       `json:"taxi"`
	Settings RosterSettings `json:"settings"`
	OwnerID  string         `json:"owner_id"`
	CoOwners []string       `json:"co_owners"`
	LeagueID string         `json:"league_id"`
	Metadata RosterMetadata `json:"metadata"`
}

type RosterMetadata struct {
	Streak string `json:"streak"`
	Record string `json:"record"`
}

type RosterSettings struct {
	Wins                 int     `json:"wins"`
	WaiverPosition       int     `json:"waiver_position"`
	WaiverBudgetUsed     int     `json:"waiver_budget_used"`
	TotalMoves           int     `json:"total_moves"`
	Ties                 int     `json:"ties"`
	Losses               int     `json:"losses"`
	MaxPoints            int     `json:"ppts"`
	MaxPointsDecimal     int     `json:"ppts_decimal"`
	PointsAgainst        int     `json:"fpts_against"`
	PointsAgainstDecimal float32 `json:"fpts_against_decimal"`
	PointsFor            int     `json:"fpts"`
	PointsForDecimal     float32 `json:"fpts_decimal"`
}

type Rosters []Roster

func (rl Rosters) WithID(id int) Roster {
	for _, r := range rl {
		if r.ID == id {
			return r
		}
	}
	return Roster{}
}

func (rl Rosters) SortedByStandings() Rosters {
	sort.Slice(rl, func(i, j int) bool {
		if rl[i].Settings.Wins > rl[j].Settings.Wins {
			return true
		}
		if rl[i].Settings.Wins == rl[j].Settings.Wins {
			if rl[i].GetPointsFor() > rl[j].GetPointsFor() {
				return true
			}
		}
		return false
	})
	return rl
}

func (r Roster) GetPointsFor() float32 {
	return float32(r.Settings.PointsFor) + float32(r.Settings.PointsForDecimal)/100
}
