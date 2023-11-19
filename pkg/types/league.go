package types

type League struct {
	ID                    string          `json:"league_id"`
	TotalRosters          int             `json:"total_rosters"`
	RosterPositions       []string        `json:"roster_positions"`
	PreviousLeagueID      *string         `json:"previous_league_id"`
	LastPinnedMessageID   string          `json:"last_pinned_message_id"`
	LastMessageTime       int64           `json:"last_message_time"`
	LastAuthorIsBot       bool            `json:"last_author_is_bot"`
	LastAuthorID          string          `json:"last_author_id"`
	LastAuthorDisplayName string          `json:"last_author_display_name"`
	DraftID               string          `json:"draft_id"`
	LastMessageID         string          `json:"last_message_id"`
	Avatar                *string         `json:"avatar"`
	ScoringSettings       ScoringSettings `json:"scoring_settings"`
	Sport                 string          `json:"sport"`
	SeasonType            string          `json:"season_type"`
	Season                string          `json:"season"`
	Shard                 int             `json:"shard"`
	CompanyID             *string         `json:"company_id"`
	Settings              LeagueSettings  `json:"settings"`
	Metadata              LeagueMetadata  `json:"metadata"`
	Status                string          `json:"status"`
	Name                  string          `json:"name"`
}

type LeagueSettings struct {
	DailyWaiversLastRan      int `json:"daily_waivers_last_ran"`
	ReserveAllowCov          int `json:"reserve_allow_cov"`
	ReserveSlots             int `json:"reserve_slots"`
	Leg                      int `json:"leg"`
	OffseasonAdds            int `json:"offseason_adds"`
	BenchLock                int `json:"bench_lock"`
	TradeReviewDays          int `json:"trade_review_days"`
	LeagueAverageMatch       int `json:"league_average_match"`
	WaiverType               int `json:"waiver_type"`
	MaxKeepers               int `json:"max_keepers"`
	Type                     int `json:"type"`
	PickTrading              int `json:"pick_trading"`
	DisableTrades            int `json:"disable_trades"`
	DailyWaivers             int `json:"daily_waivers"`
	TaxiYears                int `json:"taxi_years"`
	TradeDeadline            int `json:"trade_deadline"`
	VetoShowVotes            int `json:"veto_show_votes"`
	ReserveAllowSus          int `json:"reserve_allow_sus"`
	ReserveAllowOut          int `json:"reserve_allow_out"`
	PlayoffRoundType         int `json:"playoff_round_type"`
	WaiverDayOfWeek          int `json:"waiver_day_of_week"`
	TaxiAllowVets            int `json:"taxi_allow_vets"`
	ReserveAllowDnr          int `json:"reserve_allow_dnr"`
	VetoAutoPoll             int `json:"veto_auto_poll"`
	CommissionerDirectInvite int `json:"commissioner_direct_invite"`
	ReserveAllowDoubtful     int `json:"reserve_allow_doubtful"`
	WaiverClearDays          int `json:"waiver_clear_days"`
	PlayoffWeekStart         int `json:"playoff_week_start"`
	DailyWaiversDays         int `json:"daily_waivers_days"`
	LastScoredLeg            int `json:"last_scored_leg"`
	TaxiSlots                int `json:"taxi_slots"`
	PlayoffType              int `json:"playoff_type"`
	DailyWaiversHour         int `json:"daily_waivers_hour"`
	NumTeams                 int `json:"num_teams"`
	VetoVotesNeeded          int `json:"veto_votes_needed"`
	PlayoffTeams             int `json:"playoff_teams"`
	PlayoffSeedType          int `json:"playoff_seed_type"`
	StartWeek                int `json:"start_week"`
	ReserveAllowNa           int `json:"reserve_allow_na"`
	DraftRounds              int `json:"draft_rounds"`
	TaxiDeadline             int `json:"taxi_deadline"`
	WaiverBidMin             int `json:"waiver_bid_min"`
	CapacityOverride         int `json:"capacity_override"`
	DisableAdds              int `json:"disable_adds"`
	WaiverBudget             int `json:"waiver_budget"`
	LastReport               int `json:"last_report"`
	BestBall                 int `json:"best_ball"`
}

type ScoringSettings struct {
	StFf           float64 `json:"st_ff"`
	PtsAllow713    float64 `json:"pts_allow_7_13"`
	DefStFf        float64 `json:"def_st_ff"`
	RecYd          float64 `json:"rec_yd"`
	FumRecTd       float64 `json:"fum_rec_td"`
	PtsAllow35P    float64 `json:"pts_allow_35p"`
	PtsAllow2834   float64 `json:"pts_allow_28_34"`
	Fum            float64 `json:"fum"`
	RushYd         float64 `json:"rush_yd"`
	PassTd         float64 `json:"pass_td"`
	BlkKick        float64 `json:"blk_kick"`
	PassYd         float64 `json:"pass_yd"`
	Safe           float64 `json:"safe"`
	DefTd          float64 `json:"def_td"`
	Fgm50P         float64 `json:"fgm_50p"`
	DefStTd        float64 `json:"def_st_td"`
	FumRec         float64 `json:"fum_rec"`
	Rush2Pt        float64 `json:"rush_2pt"`
	Xpm            float64 `json:"xpm"`
	PtsAllow2127   float64 `json:"pts_allow_21_27"`
	Fgm2029        float64 `json:"fgm_20_29"`
	RecFd          float64 `json:"rec_fd"`
	PtsAllow16     float64 `json:"pts_allow_1_6"`
	FumLost        float64 `json:"fum_lost"`
	DefStFumRec    float64 `json:"def_st_fum_rec"`
	Int            float64 `json:"int"`
	Fgm019         float64 `json:"fgm_0_19"`
	PtsAllow1420   float64 `json:"pts_allow_14_20"`
	Rec            float64 `json:"rec"`
	Ff             float64 `json:"ff"`
	Fgmiss         float64 `json:"fgmiss"`
	StFumRec       float64 `json:"st_fum_rec"`
	RushFd         float64 `json:"rush_fd"`
	Rec2Pt         float64 `json:"rec_2pt"`
	RushTd         float64 `json:"rush_td"`
	Xpmiss         float64 `json:"xpmiss"`
	Fgm3039        float64 `json:"fgm_30_39"`
	RecTd          float64 `json:"rec_td"`
	StTd           float64 `json:"st_td"`
	Pass2Pt        float64 `json:"pass_2pt"`
	PtsAllow0      float64 `json:"pts_allow_0"`
	PassInt        float64 `json:"pass_int"`
	BonusRushYd100 float64 `json:"bonus_rush_yd_100"`
	BonusRecTe     float64 `json:"bonus_rec_te"`
	Fgm4049        float64 `json:"fgm_40_49"`
	Sack           float64 `json:"sack"`
}

type LeagueMetadata struct {
	KeeperDeadline string `json:"keeper_deadline"`
	AutoContinue   string `json:"auto_continue"`
}
