package types

type NFLState struct {
	Week               int    `json:"week"`
	DisplayWeek        int    `json:"display_week"`
	SeasonType         string `json:"season_type"`
	SeasonStartDate    string `json:"season_start_date"`
	ActiveSeason       string `json:"season"`
	PreviousSeason     string `json:"previous_season"`
	Leg                int    `json:"leg"`
	LeagueSeason       string `json:"league_season"`
	LeagueCreateSeason string `json:"league_create_season"`
}
