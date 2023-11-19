package types

import "fmt"

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
