package sleeper

import (
	"fmt"
	"sort"
)

// SleeperUser represents a user from the Sleeper API
type SleeperUser struct {
	ID          string       `json:"user_id"`
	Username    string       `json:"username"`
	DisplayName string       `json:"display_name"`
	Avatar      string       `json:"avatar"`
	Metadata    UserMetadata `json:"metadata"`
}

type UserMetadata struct {
	TeamName string `json:"team_name"`
}

type SleeperUsers []SleeperUser

func (us SleeperUsers) WithID(id string) SleeperUser {
	for _, u := range us {
		if u.ID == id {
			return u
		}
	}
	return SleeperUser{}
}

func (u SleeperUser) String() {
	fmt.Printf("%s - %s (%s)\n", u.TeamName(), u.DisplayName, u.ID)
}

func (u SleeperUser) TeamName() string {
	if u.Metadata.TeamName == "" {
		return u.DisplayName
	}
	return u.Metadata.TeamName
}

type SleeperUserMap map[string]SleeperUser

// NFLState represents the current NFL season state from Sleeper API
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

// Player represents NFL player data from Sleeper API
type Player struct {
	Age                int            `json:"age"`
	SearchLastName     string         `json:"search_last_name"`
	FantasyDataID      int            `json:"fantasy_data_id"`
	Hashtag            string         `json:"hashtag"`
	Height             string         `json:"height"`
	DepthChartPosition *string        `json:"depth_chart_position"`
	SearchFullName     string         `json:"search_full_name"`
	Position           string         `json:"position"`
	HighSchool         string         `json:"high_school"`
	Metadata           PlayerMetadata `json:"metadata"`
	YahooID            int            `json:"yahoo_id"`
	BirthDate          string         `json:"birth_date"`
	Number             int            `json:"number"`
	DepthChartOrder    int            `json:"depth_chart_order"`
	FantasyPositions   []string       `json:"fantasy_positions"`
	SearchFirstName    string         `json:"search_first_name"`
	LastName           string         `json:"last_name"`
	InjuryNotes        string         `json:"injury_notes"`
	PlayerID           string         `json:"player_id"`
	OddsjamID          string         `json:"oddsjam_id"`
	College            string         `json:"college"`
	Weight             string         `json:"weight"`
	EspnID             int            `json:"espn_id"`
	RotowireID         int            `json:"rotowire_id"`
	FirstName          string         `json:"first_name"`
	Status             string         `json:"status"`
	YearsExp           int            `json:"years_exp"`
	InjuryStatus       string         `json:"injury_status"`
	Active             bool           `json:"active"`
	Team               string         `json:"team"`
	SwishID            int            `json:"swish_id"`
	FullName           string         `json:"full_name"`
	SportradarID       string         `json:"sportradar_id"`
	NewsUpdated        int64          `json:"news_updated"`
	SearchRank         int            `json:"search_rank"`
	Sport              string         `json:"sport"`
	InjuryBodyPart     string         `json:"injury_body_part"`
}

type PlayerMetadata struct {
	RookieYear string `json:"rookie_year"`
}

func (p Player) String() {
	fmt.Printf("%s - %s (%s)\n", p.Position, p.FullName, p.Team)
}

type Players []Player

// Roster represents a fantasy roster from Sleeper API
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

// Matchup represents a weekly matchup from Sleeper API
type Matchup struct {
	MatchupID   int                    `json:"matchup_id"`
	RosterID    int                    `json:"roster_id"`
	Points      float64                `json:"points"`
	Players     []string               `json:"players"`
	Starters    []string               `json:"starters"`
	PlayersPointsMap map[string]float64 `json:"players_points,omitempty"`
}

type Matchups []Matchup

// SleeperLeague represents the complete league data from Sleeper API
type SleeperLeague struct {
	TotalRosters  int    `json:"total_rosters"`
	Status        string `json:"status"`
	Sport         string `json:"sport"`
	Settings      LeagueSettings `json:"settings"`
	SeasonType    string `json:"season_type"`
	Season        string `json:"season"`
	ScoringSettings ScoringSettings `json:"scoring_settings"`
	RosterPositions []string `json:"roster_positions"`
	PreviousLeagueID string `json:"previous_league_id"`
	Name          string `json:"name"`
	LeagueID      string `json:"league_id"`
	DraftID       string `json:"draft_id"`
	Avatar        string `json:"avatar"`
}

type LeagueSettings struct {
	MaxKeepers            int `json:"max_keepers"`
	DraftRounds           int `json:"draft_rounds"`
	TradeDeadline         int `json:"trade_deadline"`
	ReserveSlots          int `json:"reserve_slots"`
	TaxiSlots             int `json:"taxi_slots"`
	TaxiDeadline          int `json:"taxi_deadline"`
	TaxiYearsExp          int `json:"taxi_years_exp"`
	PlayoffWeekStart      int `json:"playoff_week_start"`
	PlayoffTeams          int `json:"playoff_teams"`
	PlayoffRounds         int `json:"playoff_rounds"`
	PlayoffSeedType       int `json:"playoff_seed_type"`
	PlayoffType           int `json:"playoff_type"`
	BenchSlots            int `json:"bench_slots"`
	WaiverType            int `json:"waiver_type"`
	WaiverClearDays       int `json:"waiver_clear_days"`
	WaiverDayOfWeek       int `json:"waiver_day_of_week"`
	WaiverBudget          int `json:"waiver_budget"`
	StartWeek             int `json:"start_week"`
	LastScoredLeg         int `json:"last_scored_leg"`
	Leg                   int `json:"leg"`
	DisableAdds           int `json:"disable_adds"`
	DisableTrades         int `json:"disable_trades"`
	TradingDeadline       int `json:"trading_deadline"`
	CapitalizeNames       int `json:"capitalize_names"`
	PlatformType          int `json:"type"`
	BestBall              int `json:"best_ball"`
}

type ScoringSettings struct {
	PassYd         float64 `json:"pass_yd"`
	PassTd         float64 `json:"pass_td"`
	PassInt        float64 `json:"pass_int"`
	RushYd         float64 `json:"rush_yd"`
	RushTd         float64 `json:"rush_td"`
	RecYd          float64 `json:"rec_yd"`
	RecTd          float64 `json:"rec_td"`
	Rec            float64 `json:"rec"`
	FumLost        float64 `json:"fum_lost"`
	// Add other scoring settings as needed
}