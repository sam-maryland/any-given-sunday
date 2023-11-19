package types

type League struct {
	ID               string `json:"league_id"`
	TotalRosters     int    `json:"total_rosters"`
	Status           string `json:"in_season"`
	Sport            string `json:"sport"`
	SeasonType       string `json:"season_type"`
	Season           string `json:"season"`
	PreviousLeagueID string `json:"previous_league_id"`
	Name             string `json:"name"`
	DraftID          string `json:"draft_id"`
	Avatar           string `json:"avatar"`
}
