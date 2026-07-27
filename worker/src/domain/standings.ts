import {
  League,
  LeagueStatus,
  NewMatchup,
  PlayoffRound,
  UserMap,
  matchupWinnerAndLoser,
} from "./types";

export interface Standing {
  userId: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  h2hWins: Map<string, number>;
}

// Builds unsorted per-user standings from regular season matchups.
export function matchupsToStandingsMap(matchups: NewMatchup[]): Map<string, Standing> {
  const standings = new Map<string, Standing>();

  const ensure = (userId: string): Standing => {
    let s = standings.get(userId);
    if (!s) {
      s = {
        userId,
        wins: 0,
        losses: 0,
        ties: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        h2hWins: new Map(),
      };
      standings.set(userId, s);
    }
    return s;
  };

  for (const m of matchups) {
    if (m.is_playoff) {
      continue;
    }

    const home = ensure(m.home_user_id);
    const away = ensure(m.away_user_id);

    home.pointsFor += m.home_score;
    home.pointsAgainst += m.away_score;
    away.pointsFor += m.away_score;
    away.pointsAgainst += m.home_score;

    if (m.home_score > m.away_score) {
      home.wins++;
      away.losses++;
      home.h2hWins.set(away.userId, (home.h2hWins.get(away.userId) ?? 0) + 1);
    } else if (m.home_score < m.away_score) {
      away.wins++;
      home.losses++;
      away.h2hWins.set(home.userId, (away.h2hWins.get(home.userId) ?? 0) + 1);
    } else {
      home.ties++;
      away.ties++;
    }
  }

  return standings;
}

// Sorts by record, then within same-win groups: H2H wins, points for,
// points against, coin flip.
export function sortStandingsMap(standingsMap: Map<string, Standing>): Standing[] {
  const groups = new Map<number, Standing[]>();
  for (const standing of standingsMap.values()) {
    const group = groups.get(standing.wins);
    if (group) {
      group.push(standing);
    } else {
      groups.set(standing.wins, [standing]);
    }
  }

  const winCounts = [...groups.keys()].sort((a, b) => b - a);

  const finalStandings: Standing[] = [];
  for (const winCount of winCounts) {
    const group = groups.get(winCount)!;

    if (group.length > 1) {
      const groupWins = new Map<string, number>();
      for (const t of group) {
        let wins = 0;
        for (const opponent of group) {
          if (t.userId !== opponent.userId) {
            wins += t.h2hWins.get(opponent.userId) ?? 0;
          }
        }
        groupWins.set(t.userId, wins);
      }

      group.sort((a, b) => {
        const h2hDiff = (groupWins.get(b.userId) ?? 0) - (groupWins.get(a.userId) ?? 0);
        if (h2hDiff !== 0) return h2hDiff;
        if (a.pointsFor !== b.pointsFor) return b.pointsFor - a.pointsFor;
        if (a.pointsAgainst !== b.pointsAgainst) return a.pointsAgainst - b.pointsAgainst;
        return coinFlip();
      });
    }

    finalStandings.push(...group);
  }

  return finalStandings;
}

function coinFlip(): number {
  const buf = new Uint8Array(1);
  crypto.getRandomValues(buf);
  return (buf[0]! & 1) === 0 ? -1 : 1;
}

export interface LeagueStandings {
  standings: Standing[];
  // False when a COMPLETE league has no usable playoff matchups (e.g. they
  // were never tagged in the DB) and the order is regular season record only.
  usedPlayoffResults: boolean;
}

// Computes sorted standings for a league. For a COMPLETE league the top six
// placements come from playoff results instead of regular season record; if
// the playoff matchups are missing or malformed, falls back to regular
// season order rather than failing the whole command.
export function standingsForLeague(league: League, matchups: NewMatchup[]): LeagueStandings {
  if (league.status === LeagueStatus.Pending) {
    throw new Error("league year has not started yet");
  }

  const standingsMap = matchupsToStandingsMap(matchups);
  const sortedStandings = sortStandingsMap(standingsMap);

  if (league.status !== LeagueStatus.Complete) {
    return { standings: sortedStandings, usedPlayoffResults: false };
  }

  try {
    return {
      standings: playoffPlacements(standingsMap, sortedStandings, matchups),
      usedPlayoffResults: true,
    };
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "playoff_placement_unavailable",
        year: league.year,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { standings: sortedStandings, usedPlayoffResults: false };
  }
}

function playoffPlacements(
  standingsMap: Map<string, Standing>,
  sortedStandings: Standing[],
  matchups: NewMatchup[],
): Standing[] {
  const matchupsByRound = new Map<string, NewMatchup[]>();
  for (const m of matchups) {
    if (!m.is_playoff || !m.playoff_round) {
      continue;
    }
    const round = matchupsByRound.get(m.playoff_round);
    if (round) {
      round.push(m);
    } else {
      matchupsByRound.set(m.playoff_round, [m]);
    }
  }

  const finals = matchupsByRound.get(PlayoffRound.Finals);
  if (!finals || finals.length !== 1) {
    throw new Error("invalid finals data");
  }
  const finalsResult = matchupWinnerAndLoser(finals[0]!);

  const thirdPlaceGame = matchupsByRound.get(PlayoffRound.ThirdPlace);
  if (!thirdPlaceGame || thirdPlaceGame.length !== 1) {
    throw new Error("invalid third place game data");
  }
  const thirdPlaceResult = matchupWinnerAndLoser(thirdPlaceGame[0]!);

  const quarterfinals = matchupsByRound.get(PlayoffRound.Quarterfinals);
  if (!quarterfinals || quarterfinals.length !== 2) {
    throw new Error("invalid quarterfinals data");
  }
  const quarterfinalLosers = quarterfinals.map((q) => matchupWinnerAndLoser(q).loser);

  const bySeed = (userId: string): Standing => standingsMap.get(userId)!;
  const sortedQuarterfinalLosers = sortStandingsMap(
    new Map(quarterfinalLosers.map((id) => [id, bySeed(id)])),
  );

  return [
    bySeed(finalsResult.winner),
    bySeed(finalsResult.loser),
    bySeed(thirdPlaceResult.winner),
    bySeed(thirdPlaceResult.loser),
    ...sortedQuarterfinalLosers,
    ...sortedStandings.slice(6),
  ];
}

export function standingsToDiscordMessage(
  standings: Standing[],
  league: League,
  users: UserMap,
): string {
  let b = "";

  if (league.status === LeagueStatus.Complete) {
    b += `**🏆 ${league.year} Final Standings 🏆**\n\n`;
  } else {
    b += `**🏆 ${league.year} Standings 🏆**\n\n`;
  }

  const medals = ["🥇", "🥈", "🥉"];
  standings.forEach((st, i) => {
    const rank = medals[i] ?? `${i + 1}.`;

    if (league.status === LeagueStatus.InProgress && i === 6) {
      b += "\n────────────── **Playoffs** ──────────────\n\n";
    }

    const name = users.get(st.userId)?.name || st.userId;
    b += `${rank} **${name}** - ${st.wins}-${st.losses}-${st.ties} (PF: ${st.pointsFor.toFixed(1)}, PA: ${st.pointsAgainst.toFixed(1)})\n`;
  });

  return b;
}
