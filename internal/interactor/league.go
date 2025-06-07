package interactor

import (
	"context"
	"errors"

	"github.com/sam-maryland/any-given-sunday/pkg/types/converters"
	"github.com/sam-maryland/any-given-sunday/pkg/types/domain"
)

type LeagueInteractor interface {
	GetLatestLeague(ctx context.Context) (domain.League, error)
	GetLeagueByYear(ctx context.Context, year int) (domain.League, error)
	GetStandingsForLeague(ctx context.Context, league domain.League) (domain.Standings, error)
}

// GetLatestLeague retrieves the latest league from the database.
// The latest league is either the in-progress league or the most recent completed league if there is no in-progress league.
func (i *interactor) GetLatestLeague(ctx context.Context) (domain.League, error) {
	league, err := i.DB.GetLatestLeague(ctx)
	if err != nil {
		return domain.League{}, err
	}
	return converters.LeagueFromDB(league), nil
}

// GetLeagueByYear retrieves a league by its year from the database.
func (i *interactor) GetLeagueByYear(ctx context.Context, year int) (domain.League, error) {
	league, err := i.DB.GetLeagueByYear(ctx, int32(year))
	if err != nil {
		return domain.League{}, err
	}
	return converters.LeagueFromDB(league), nil
}

// GetStandingsForLeague retrieves the sorted standings for a given league.
func (i *interactor) GetStandingsForLeague(ctx context.Context, league domain.League) (domain.Standings, error) {
	if league.Status == domain.LeagueStatusPending {
		return domain.Standings{}, errors.New("league year has not started yet")
	}

	matchups, err := i.DB.GetMatchupsByYear(ctx, int32(league.Year))
	if err != nil {
		return domain.Standings{}, err
	}
	allMatchups := converters.MatchupsFromDB(matchups)
	standingsMap := domain.MatchupsToStandingsMap(allMatchups)
	sortedStandings := standingsMap.SortStandingsMap()

	// If the league is complete, the top six teams are based on the playoff results
	if league.Status == domain.LeagueStatusComplete {
		matchupsByRound := map[string]domain.Matchups{}
		for _, m := range allMatchups {
			if !m.IsPlayoff || m.PlayoffRound == nil {
				continue
			}
			matchupsByRound[*m.PlayoffRound] = append(matchupsByRound[*m.PlayoffRound], m)
		}

		// First and Second Place are the finals winners and losers
		finals, ok := matchupsByRound[domain.PlayoffRoundFinals]
		if !ok || len(finals) != 1 {
			return domain.Standings{}, errors.New("invalid finals data")
		}
		finalsWinner, finalsLoser := finals[0].WinnerAndLoser()
		first, second := standingsMap[finalsWinner], standingsMap[finalsLoser]

		// Third and Fourth Place are the third place game winners and losers
		thirdPlaceGame, ok := matchupsByRound[domain.PlayoffRoundThirdPlace]
		if !ok || len(thirdPlaceGame) != 1 {
			return domain.Standings{}, errors.New("invalid third place game data")
		}
		thirdPlaceGameWinner, thirdPlaceGameLoser := thirdPlaceGame[0].WinnerAndLoser()
		third, fourth := standingsMap[thirdPlaceGameWinner], standingsMap[thirdPlaceGameLoser]

		// Fifth and Sixth Place are the losers of the quarterfinals
		quarterfinals, ok := matchupsByRound[domain.PlayoffRoundQuarterfinals]
		if !ok || len(quarterfinals) != 2 {
			return domain.Standings{}, errors.New("invalid quarterfinals data")
		}
		var quarterfinalLosers []string
		for _, q := range quarterfinals {
			quarterfinalLosers = append(quarterfinalLosers, q.Loser())
		}
		sortedQuarterfinalLosers := domain.Standings{standingsMap[quarterfinalLosers[0]], standingsMap[quarterfinalLosers[1]]}.SortStandings()

		// 7th thru 12th place are the remaining teams
		finalStandings := append(
			domain.Standings{first, second, third, fourth, sortedQuarterfinalLosers[0], sortedQuarterfinalLosers[1]},
			sortedStandings[6:]...,
		)

		return finalStandings, nil
	}

	return sortedStandings, nil
}
