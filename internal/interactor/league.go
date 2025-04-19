package interactor

import (
	"any-given-sunday/pkg/types"
	"context"
	"errors"
)

type LeagueInteractor interface {
	GetLatestLeagueYear(ctx context.Context) (int, error)
	GetStandingsForYear(ctx context.Context, year int) (types.Standings, error)
}

func (i *interactor) GetLatestLeagueYear(ctx context.Context) (int, error) {
	year, err := i.Queries.GetLatestLeagueYear(ctx)
	if err != nil {
		return 0, err
	}
	return int(year), nil
}

func (i *interactor) GetStandingsForYear(ctx context.Context, year int) (types.Standings, error) {
	league, err := i.Queries.GetLeagueByYear(ctx, int32(year))
	if err != nil {
		return types.Standings{}, err
	}

	if league.Status == types.LeagueStatusPending {
		return types.Standings{}, errors.New("league year has not started yet")
	}

	matchups, err := i.Queries.GetMatchupsByYear(ctx, int32(year))
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

		finals, ok := matchupsByRound[types.PlayoffRoundFinals]
		if !ok || len(finals) != 1 {
			return types.Standings{}, errors.New("invalid finals data")
		}
		finalsWinner, finalsLoser := finals[0].WinnerAndLoser()
		first, second := standingsMap[finalsWinner], standingsMap[finalsLoser]

		thirdPlaceGame, ok := matchupsByRound[types.PlayoffRoundThirdPlace]
		if !ok || len(thirdPlaceGame) != 1 {
			return types.Standings{}, errors.New("invalid third place game data")
		}
		thirdPlaceGameWinner, thirdPlaceGameLoser := thirdPlaceGame[0].WinnerAndLoser()
		third, fourth := standingsMap[thirdPlaceGameWinner], standingsMap[thirdPlaceGameLoser]

		quarterfinals, ok := matchupsByRound[types.PlayoffRoundQuarterfinals]
		if !ok || len(quarterfinals) != 2 {
			return types.Standings{}, errors.New("invalid quarterfinals data")
		}
		var quarterfinalLosers []string
		for _, q := range quarterfinals {
			quarterfinalLosers = append(quarterfinalLosers, q.Loser())
		}
		sortedQuarterfinalLosers := types.Standings{standingsMap[quarterfinalLosers[0]], standingsMap[quarterfinalLosers[1]]}.SortStandings()

		finalStandings := append(
			types.Standings{first, second, third, fourth, sortedQuarterfinalLosers[0], sortedQuarterfinalLosers[1]},
			sortedStandings[6:]...,
		)

		return finalStandings, nil
	}

	return sortedStandings, nil
}
