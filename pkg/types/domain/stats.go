package domain

import (
	"fmt"
	"strings"

	"github.com/sam-maryland/any-given-sunday/pkg/config"
)

type CareerStats struct {
	UserID                     string
	UserName                   string
	SeasonsPlayed              int64
	RegularSeasonRecord        string
	RegularSeasonAvgPoints     float64
	RegularSeasonPointsFor     float64
	RegularSeasonPointsAgainst float64
	HighestRegularSeasonScore  float64
	WeeklyHighScores           int64
	PlayoffAppearances         int64
	PlayoffRecord              string
	QuarterfinalAppearances    int64
	SemifinalAppearances       int64
	FinalsAppearances          int64
	FirstPlaceFinishes         int64
	SecondPlaceFinishes        int64
	ThirdPlaceFinishes         int64
	PlayoffPointsFor           float64
	PlayoffPointsAgainst       float64
	PlayoffAvgPoints           float64
}

func (c CareerStats) ToDiscordMessage(username string) string {
	var b strings.Builder

	fmt.Fprintf(&b, "**%s's Career Stats** 📊\n\n", username)

	// 🏆 Trophy Case
	if c.FirstPlaceFinishes > 0 || c.SecondPlaceFinishes > 0 || c.ThirdPlaceFinishes > 0 {
		fmt.Fprintln(&b, "🏆 **Trophy Case:**")
		if c.FirstPlaceFinishes > 0 {
			fmt.Fprintf(&b, "   🏆 %dx Champion\n", c.FirstPlaceFinishes)
		}
		if c.SecondPlaceFinishes > 0 {
			fmt.Fprintf(&b, "   🥈 %dx Runner-Up\n", c.SecondPlaceFinishes)
		}
		if c.ThirdPlaceFinishes > 0 {
			fmt.Fprintf(&b, "   🥉 %dx Third Place Finish\n", c.ThirdPlaceFinishes)
		}
		fmt.Fprintln(&b)
	} else {
		fmt.Fprintln(&b, "🏆 **Trophy Case:** 🕳️ A black hole of missed opportunities.")
		fmt.Fprintln(&b)
	}

	// 💵 Career Earnings
	earnings := c.CalculateCareerEarnings() // This should return a float64 or int
	if earnings > 0 {
		fmt.Fprintf(&b, "💵 **Career Earnings:** **$%d** — %s is rollin’ in 💰\n\n", earnings, username)
	} else if earnings < 0 {
		fmt.Fprintf(&b, "💵 **Career Earnings:** ❌ **-$%d** — %s is keeping the league solvent 🐖💥\n\n", -earnings, username)
	} else {
		fmt.Fprintf(&b, "💵 **Career Earnings:** **$0** — %s has broken exactly even. Impressive... or lucky? 🤷‍♂️\n\n", username)
	}

	// 🏟️ Regular Season
	fmt.Fprintf(&b, "🏟️ **Regular Season:** %s\n", c.RegularSeasonRecord)
	fmt.Fprintf(&b, "   ↳ Avg Points: %.1f\n", c.RegularSeasonAvgPoints)
	fmt.Fprintf(&b, "   ↳ Points For: %.1f\n", c.RegularSeasonPointsFor)
	fmt.Fprintf(&b, "   ↳ Points Against: %.1f\n", c.RegularSeasonPointsAgainst)
	fmt.Fprintf(&b, "   ↳ Weekly High Scores: %d\n", c.WeeklyHighScores)
	fmt.Fprintf(&b, "   ↳ Highest Score: %.1f\n\n", c.HighestRegularSeasonScore)

	// 🎯 Playoffs
	if c.PlayoffAppearances == 0 {
		fmt.Fprintf(&b, "🎯 **Playoffs:** 🫡 Hasn't made the playoffs... yet.\n\n")
	} else {
		fmt.Fprintf(&b, "🎯 **Playoffs:** %s (%d appearances)\n",
			c.PlayoffRecord, c.PlayoffAppearances)
		fmt.Fprintf(&b, "   ↳ Quarterfinals: %d\n", c.QuarterfinalAppearances)
		fmt.Fprintf(&b, "   ↳ Semifinals: %d\n", c.SemifinalAppearances)
		fmt.Fprintf(&b, "   ↳ Finals: %d\n", c.FinalsAppearances)
		fmt.Fprintf(&b, "   ↳ Avg Points: %.1f\n", c.PlayoffAvgPoints)
		fmt.Fprintf(&b, "   ↳ Points For: %.1f\n", c.PlayoffPointsFor)
		fmt.Fprintf(&b, "   ↳ Points Against: %.1f\n\n", c.PlayoffPointsAgainst)
	}

	return b.String()
}

func (c CareerStats) CalculateCareerEarnings() int {
	earnings := 0
	earnings -= int(c.SeasonsPlayed) * config.PayInBuyIn
	earnings += int(c.WeeklyHighScores) * config.PayOutWeeklyHighScore
	earnings += int(c.FirstPlaceFinishes) * config.PayOutFirstPlace
	earnings += int(c.SecondPlaceFinishes) * config.PayOutSecondPlace
	earnings += int(c.ThirdPlaceFinishes) * config.PayOutThirdPlace
	return earnings
}
