package interactor

import (
	"any-given-sunday/pkg/types"
	"context"
	"errors"
)

type LeagueInteractor interface {
	GetLatestLeague(ctx context.Context) (types.League, error)
	GetLeagueByYear(ctx context.Context, year int) (types.League, error)
	GetStandingsForLeague(ctx context.Context, league types.League) (types.Standings, error)
}

// GetLatestLeague retrieves the latest league from the database.
// The latest league is either the in-progress league or the most recent completed league if there is no in-progress league.
func (i *interactor) GetLatestLeague(ctx context.Context) (types.League, error) {
	league, err := i.Queries.GetLatestLeague(ctx)
	if err != nil {
		return types.League{}, err
	}
	return types.FromDBLeague(league), nil
}

// GetLeagueByYear retrieves a league by its year from the database.
func (i *interactor) GetLeagueByYear(ctx context.Context, year int) (types.League, error) {
	league, err := i.Queries.GetLeagueByYear(ctx, int32(year))
	if err != nil {
		return types.League{}, err
	}
	return types.FromDBLeague(league), nil
}

// GetStandingsForLeague retrieves the sorted standings for a given league.
func (i *interactor) GetStandingsForLeague(ctx context.Context, league types.League) (types.Standings, error) {
	if league.Status == types.LeagueStatusPending {
		return types.Standings{}, errors.New("league year has not started yet")
	}

	matchups, err := i.Queries.GetMatchupsByYear(ctx, int32(league.Year))
	if err != nil {
		return types.Standings{}, err
	}
	allMatchups := types.FromDBMatchups(matchups)
	standingsMap := types.MatchupsToStandingsMap(allMatchups)
	sortedStandings := standingsMap.SortStandingsMap()

	// If the league is complete, the top six teams are based on the playoff results
	if league.Status == types.LeagueStatusComplete {
		matchupsByRound := map[string]types.Matchups{}
		for _, m := range allMatchups {
			if !m.IsPlayoff {
				continue
			}
			matchupsByRound[m.PlayoffRound] = append(matchupsByRound[m.PlayoffRound], m)
		}

		// First and Second Place are the finals winners and losers
		finals, ok := matchupsByRound[types.PlayoffRoundFinals]
		if !ok || len(finals) != 1 {
			return types.Standings{}, errors.New("invalid finals data")
		}
		finalsWinner, finalsLoser := finals[0].WinnerAndLoser()
		first, second := standingsMap[finalsWinner], standingsMap[finalsLoser]

		// Third and Fourth Place are the third place game winners and losers
		thirdPlaceGame, ok := matchupsByRound[types.PlayoffRoundThirdPlace]
		if !ok || len(thirdPlaceGame) != 1 {
			return types.Standings{}, errors.New("invalid third place game data")
		}
		thirdPlaceGameWinner, thirdPlaceGameLoser := thirdPlaceGame[0].WinnerAndLoser()
		third, fourth := standingsMap[thirdPlaceGameWinner], standingsMap[thirdPlaceGameLoser]

		// Fifth and Sixth Place are the losers of the quarterfinals
		quarterfinals, ok := matchupsByRound[types.PlayoffRoundQuarterfinals]
		if !ok || len(quarterfinals) != 2 {
			return types.Standings{}, errors.New("invalid quarterfinals data")
		}
		var quarterfinalLosers []string
		for _, q := range quarterfinals {
			quarterfinalLosers = append(quarterfinalLosers, q.Loser())
		}
		sortedQuarterfinalLosers := types.Standings{standingsMap[quarterfinalLosers[0]], standingsMap[quarterfinalLosers[1]]}.SortStandings()

		// 7th thru 12th place are the remaining teams
		finalStandings := append(
			types.Standings{first, second, third, fourth, sortedQuarterfinalLosers[0], sortedQuarterfinalLosers[1]},
			sortedStandings[6:]...,
		)

		return finalStandings, nil
	}

	return sortedStandings, nil
}
