package converters

import (
	"fmt"

	"github.com/sam-maryland/any-given-sunday/pkg/db"
	"github.com/sam-maryland/any-given-sunday/pkg/types/domain"
)

// User conversions
func UserFromDB(u db.User) domain.User {
	return domain.User{
		ID:        u.ID,
		Name:      u.Name,
		DiscordID: u.DiscordID,
	}
}

func UsersFromDB(users []db.User) domain.Users {
	var result domain.Users
	for _, u := range users {
		result = append(result, UserFromDB(u))
	}
	return result
}

func UsersToUserMap(users []db.User) domain.UserMap {
	userMap := make(domain.UserMap)
	for _, u := range users {
		userMap[u.ID] = UserFromDB(u)
	}
	return userMap
}

// League conversions
func LeagueFromDB(l db.League) domain.League {
	return domain.League{
		ID:          l.ID,
		Year:        int(l.Year), // Convert int32 to int
		FirstPlace:  l.FirstPlace,
		SecondPlace: l.SecondPlace,
		ThirdPlace:  l.ThirdPlace,
		Status:      l.Status,
	}
}

// Matchup conversions
func MatchupFromDB(m db.Matchup) domain.Matchup {
	matchup := domain.Matchup{
		Year:      int(m.Year), // Convert int32 to int
		Week:      int(m.Week), // Convert int32 to int
		HomeScore: m.HomeScore,
		AwayScore: m.AwayScore,
		HomeUserID: m.HomeUserID,
		AwayUserID: m.AwayUserID,
	}

	// Handle UUID safely
	if m.ID.Valid {
		matchup.ID = m.ID.String()
	}

	// Handle nullable boolean
	if m.IsPlayoff.Valid {
		matchup.IsPlayoff = m.IsPlayoff.Bool
	}

	// Handle nullable text
	if m.PlayoffRound.Valid {
		matchup.PlayoffRound = &m.PlayoffRound.String
	}

	// Handle nullable integers
	if m.HomeSeed.Valid {
		seed := int(m.HomeSeed.Int32)
		matchup.HomeSeed = &seed
	}
	if m.AwaySeed.Valid {
		seed := int(m.AwaySeed.Int32)
		matchup.AwaySeed = &seed
	}

	return matchup
}

func MatchupsFromDB(matchups []db.Matchup) domain.Matchups {
	var result domain.Matchups
	for _, m := range matchups {
		result = append(result, MatchupFromDB(m))
	}
	return result
}

// CareerStats conversions with safe type handling
func CareerStatsFromDB(stat db.CareerStat) domain.CareerStats {
	stats := domain.CareerStats{
		UserID:                     stat.UserID,
		UserName:                   stat.UserName,
		SeasonsPlayed:              stat.SeasonsPlayed,
		RegularSeasonRecord:        fmt.Sprintf("%d-%d", stat.RegularSeasonWins, stat.RegularSeasonLosses),
		RegularSeasonAvgPoints:     stat.RegularSeasonAvgPoints,
		HighestRegularSeasonScore:  stat.HighestRegularSeasonScore,
		WeeklyHighScores:           stat.WeeklyHighScores,
		PlayoffAppearances:         stat.PlayoffAppearances,
		PlayoffRecord:              fmt.Sprintf("%d-%d", stat.PlayoffWins, stat.PlayoffLosses),
		QuarterfinalAppearances:    stat.QuarterfinalAppearances,
		SemifinalAppearances:       stat.SemifinalAppearances,
		FinalsAppearances:          stat.FinalsAppearances,
		FirstPlaceFinishes:         stat.FirstPlaceFinishes,
		SecondPlaceFinishes:        stat.SecondPlaceFinishes,
		ThirdPlaceFinishes:         stat.ThirdPlaceFinishes,
	}

	// Safely handle interface{} fields with type assertions
	if points, ok := stat.RegularSeasonPointsFor.(float64); ok {
		stats.RegularSeasonPointsFor = points
	}
	if points, ok := stat.RegularSeasonPointsAgainst.(float64); ok {
		stats.RegularSeasonPointsAgainst = points
	}
	if points, ok := stat.PlayoffPointsFor.(float64); ok {
		stats.PlayoffPointsFor = points
	}
	if points, ok := stat.PlayoffPointsAgainst.(float64); ok {
		stats.PlayoffPointsAgainst = points
	}
	if avg, ok := stat.PlayoffAvgPoints.(float64); ok {
		stats.PlayoffAvgPoints = avg
	}

	return stats
}