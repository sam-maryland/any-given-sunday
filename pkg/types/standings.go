package types

import (
	"fmt"
	"math/rand/v2"
	"sort"
	"strings"
)

type Standing struct {
	UserID        string
	Wins          int
	Losses        int
	Ties          int
	PointsFor     float64
	PointsAgainst float64
	H2HWins       map[string]int // number of wins vs. another user
}

// MatchupsToStandingsMap - Converts a slice of Matchups into a map of unsorted Standings.
func MatchupsToStandingsMap(ms Matchups) StandingsMap {
	standings := make(map[string]*Standing)

	for _, m := range ms {
		if m.IsPlayoff {
			continue // Skip playoff games
		}

		// Ensure both teams exist
		for _, userID := range []string{m.HomeUserID, m.AwayUserID} {
			if _, exists := standings[userID]; !exists {
				standings[userID] = &Standing{
					UserID:  userID,
					H2HWins: make(map[string]int),
				}
			}
		}

		home := standings[m.HomeUserID]
		away := standings[m.AwayUserID]

		// Update PF/PA
		home.PointsFor += m.HomeScore
		home.PointsAgainst += m.AwayScore
		away.PointsFor += m.AwayScore
		away.PointsAgainst += m.HomeScore

		// W/L/T and H2H
		switch {
		case m.HomeScore > m.AwayScore:
			home.Wins++
			away.Losses++
			home.H2HWins[away.UserID]++
		case m.HomeScore < m.AwayScore:
			away.Wins++
			home.Losses++
			away.H2HWins[home.UserID]++
		default:
			home.Ties++
			away.Ties++
		}
	}

	return standings
}

type Standings []*Standing

func (s Standings) SortStandings() Standings {
	sm := StandingsMap{}
	for _, standing := range s {
		sm[standing.UserID] = standing
	}
	return sm.SortStandingsMap()
}

func (s Standings) ToDiscordMessage(year int, users UserMap) string {
	var b strings.Builder
	fmt.Fprintf(&b, "**🏆 %d Final Standings 🏆**\n\n", year)

	// Top 3 rankings with emojis
	medals := []string{"🥇", "🥈", "🥉"}
	for i, st := range s {
		// Format rank and name
		rank := fmt.Sprintf("%d.", i+1)
		if i < len(medals) {
			rank = medals[i]
		}

		name := users[st.UserID].Name
		if name == "" {
			name = st.UserID // Fallback if no name
		}

		// Write standings in a clean format
		fmt.Fprintf(&b, "%s **%s** - %d-%d-%d (PF: %.1f, PA: %.1f)\n", rank, name, st.Wins, st.Losses, st.Ties, st.PointsFor, st.PointsAgainst)
	}

	return b.String()
}

type StandingsMap map[string]*Standing

// SortStandingsMap - Sorts the standings based on the following criteria:
// 1. Record (descending)
// Tiebreakers:
// 2. H2H wins (descending)
// 3. Points For (descending)
// 4. Points Against (ascending)
// 5. Coin flip (random)
func (s StandingsMap) SortStandingsMap() Standings {
	// Group teams by number of wins using int keys
	groups := make(map[int][]*Standing)
	for _, standing := range s {
		groups[standing.Wins] = append(groups[standing.Wins], standing)
	}

	// Get sorted list of win counts (descending)
	var winCounts []int
	for wins := range groups {
		winCounts = append(winCounts, wins)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(winCounts)))

	var finalStandings Standings

	for _, winCount := range winCounts {
		group := groups[winCount]

		if len(group) > 1 {
			// Calculate H2H wins within the group
			groupWins := make(map[string]int)
			for _, t := range group {
				for _, opponent := range group {
					if t.UserID != opponent.UserID {
						groupWins[t.UserID] += t.H2HWins[opponent.UserID]
					}
				}
			}

			// Tiebreakers
			sort.SliceStable(group, func(i, j int) bool {
				// 1. H2H Wins
				if groupWins[group[i].UserID] != groupWins[group[j].UserID] {
					return groupWins[group[i].UserID] > groupWins[group[j].UserID]
				}
				// 2. Points For
				if group[i].PointsFor != group[j].PointsFor {
					return group[i].PointsFor > group[j].PointsFor
				}
				// 3. Points Against
				if group[i].PointsAgainst != group[j].PointsAgainst {
					return group[i].PointsAgainst < group[j].PointsAgainst
				}
				// 4. Coin Flip
				return rand.IntN(2) == 0
			})
		}

		// Append group to final standings (convert from pointer to value)
		for _, standing := range group {
			finalStandings = append(finalStandings, standing)
		}
	}

	return finalStandings
}
