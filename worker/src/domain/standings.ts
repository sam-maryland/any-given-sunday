import {
  League,
  LeagueStatus,
  NewMatchup,
  PlayoffRound,
  UserMap,
  matchupWinnerAndLoser,
} from "./types";

// Teams that make the playoffs. Standings displays draw a cut line here while
// a season is in progress.
export const PLAYOFF_TEAM_COUNT = 6;

export interface Standing {
  userId: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  h2hWins: Map<string, number>;
  /** Regular season games played against each opponent, ties included. */
  h2hGames: Map<string, number>;
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
        h2hGames: new Map(),
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
    home.h2hGames.set(away.userId, (home.h2hGames.get(away.userId) ?? 0) + 1);
    away.h2hGames.set(home.userId, (away.h2hGames.get(home.userId) ?? 0) + 1);

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

// The criterion that put one team directly above the next. "headToHeadSweep"
// is a team that beat every other tied team, which counts even when the tied
// teams have not all played each other. "playoffs" means the order came from
// playoff results (or from making the playoffs at all).
export type Separator =
  | "wins"
  | "headToHead"
  | "headToHeadSweep"
  | "pointsFor"
  | "pointsAgainst"
  | "coinFlip"
  | "playoffs";

/** A team's record in games against a set of other teams. */
export interface GroupRecord {
  wins: number;
  losses: number;
  ties: number;
}

export interface Comparison {
  by: Separator;
  /**
   * For two teams level on wins: whether head-to-head could be used at their
   * stage of the tiebreak, and each team's record against the teams still
   * tied with them there. Null when wins separated them.
   */
  headToHead: { used: boolean; records: [GroupRecord, GroupRecord] } | null;
}

// How a completed season ended for a team, when playoff results were used.
export type Finish =
  | "champion"
  | "runnerUp"
  | "thirdPlace"
  | "fourthPlace"
  | "quarterfinal"
  | "missedPlayoffs";

export interface RankExplanation {
  /** Regular season rank: the playoff seed for the top six. */
  seed: number;
  /** Why this team sits directly above the next one; null for last place. */
  aheadOfNext: Comparison | null;
  /** The regular season win tie this team was part of, if any. */
  tie: {
    size: number;
    record: GroupRecord;
    /** Whether every team in the tie has played every other one. */
    allPlayed: boolean;
  } | null;
  finish: Finish | null;
}

interface Ranked {
  standing: Standing;
  aheadOfNext: Comparison | null;
}

function recordWithin(team: Standing, group: Standing[]): GroupRecord {
  const record = { wins: 0, losses: 0, ties: 0 };
  for (const opponent of group) {
    if (opponent.userId === team.userId) continue;
    const games = team.h2hGames.get(opponent.userId) ?? 0;
    const wins = team.h2hWins.get(opponent.userId) ?? 0;
    const losses = opponent.h2hWins.get(team.userId) ?? 0;
    record.wins += wins;
    record.losses += losses;
    record.ties += games - wins - losses;
  }
  return record;
}

function winPct(r: GroupRecord): number {
  const games = r.wins + r.losses + r.ties;
  return games === 0 ? 0 : (r.wins + r.ties / 2) / games;
}

function allPlayed(group: Standing[]): boolean {
  return group.every((a) =>
    group.every((b) => a.userId === b.userId || (a.h2hGames.get(b.userId) ?? 0) > 0),
  );
}

// A team that beat every other team in the group and lost to none of them.
function sweeper(group: Standing[]): Standing | undefined {
  return group.find((t) =>
    group.every(
      (o) =>
        o.userId === t.userId ||
        ((t.h2hWins.get(o.userId) ?? 0) > 0 && (o.h2hWins.get(t.userId) ?? 0) === 0),
    ),
  );
}

// Orders teams level on wins and says why each sits above the next:
//   1. Head-to-head, only when it is fair to use: every tied team has played
//      every other (best record in those games first), or one team beat all
//      the others (it goes first, and the rest start the tiebreak over).
//      Otherwise it is skipped, since counting wins would reward a team for
//      having played more of the tied teams.
//   2. Points for. 3. Points against. 4. Coin flip.
function rankTie(group: Standing[], coin: Map<string, number>): Ranked[] {
  if (group.length === 1) {
    return [{ standing: group[0]!, aheadOfNext: null }];
  }

  const records = new Map(group.map((t) => [t.userId, recordWithin(t, group)]));
  const h2h = (a: Standing, b: Standing, used: boolean): Comparison["headToHead"] => ({
    used,
    records: [records.get(a.userId)!, records.get(b.userId)!],
  });

  const everyonePlayed = allPlayed(group);
  const sweep = everyonePlayed ? undefined : sweeper(group);
  if (sweep) {
    const rest = rankTie(
      group.filter((t) => t !== sweep),
      coin,
    );
    return [
      { standing: sweep, aheadOfNext: { by: "headToHeadSweep", headToHead: h2h(sweep, rest[0]!.standing, true) } },
      ...rest,
    ];
  }

  const pct = (t: Standing) => (everyonePlayed ? winPct(records.get(t.userId)!) : 0);
  const separate = (a: Standing, b: Standing): Separator => {
    if (pct(a) !== pct(b)) return "headToHead";
    if (a.pointsFor !== b.pointsFor) return "pointsFor";
    if (a.pointsAgainst !== b.pointsAgainst) return "pointsAgainst";
    return "coinFlip";
  };
  const sorted = [...group].sort(
    (a, b) =>
      pct(b) - pct(a) ||
      b.pointsFor - a.pointsFor ||
      a.pointsAgainst - b.pointsAgainst ||
      coin.get(a.userId)! - coin.get(b.userId)!,
  );

  return sorted.map((t, i) => {
    const next = sorted[i + 1];
    return {
      standing: t,
      aheadOfNext: next ? { by: separate(t, next), headToHead: h2h(t, next, everyonePlayed) } : null,
    };
  });
}

// Sorts by wins, then breaks ties with rankTie, recording why each team is
// above the next.
function rankStandings(teams: Standing[]): Ranked[] {
  // One random draw per team per sort, so the coin flip is a consistent
  // ordering rather than a comparator that answers differently each call.
  const coin = new Map(teams.map((t) => [t.userId, randomUnit()]));

  const groups = new Map<number, Standing[]>();
  for (const t of teams) {
    const group = groups.get(t.wins);
    if (group) group.push(t);
    else groups.set(t.wins, [t]);
  }

  const ranked: Ranked[] = [];
  for (const wins of [...groups.keys()].sort((a, b) => b - a)) {
    const last = ranked[ranked.length - 1];
    if (last) last.aheadOfNext = { by: "wins", headToHead: null };
    ranked.push(...rankTie(groups.get(wins)!, coin));
  }
  return ranked;
}

export function sortStandingsMap(standingsMap: Map<string, Standing>): Standing[] {
  return rankStandings([...standingsMap.values()]).map((r) => r.standing);
}

function randomUnit(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! / 2 ** 32;
}

export interface LeagueStandings {
  standings: Standing[];
  // False when a COMPLETE league has no usable playoff matchups (e.g. they
  // were never tagged in the DB) and the order is regular season record only.
  usedPlayoffResults: boolean;
  /** Why each team holds its place, in the same order as `standings`. */
  explanations: RankExplanation[];
}

const FINISHES: Finish[] = [
  "champion",
  "runnerUp",
  "thirdPlace",
  "fourthPlace",
  "quarterfinal",
  "quarterfinal",
];

// Computes sorted standings for a league. For a COMPLETE league the top six
// placements come from playoff results instead of regular season record; if
// the playoff matchups are missing or malformed, falls back to regular
// season order rather than failing the whole command.
export function standingsForLeague(league: League, matchups: NewMatchup[]): LeagueStandings {
  if (league.status === LeagueStatus.Pending) {
    throw new Error("league year has not started yet");
  }

  const standingsMap = matchupsToStandingsMap(matchups);
  const ranked = rankStandings([...standingsMap.values()]);
  const regularSeason = (): LeagueStandings => ({
    standings: ranked.map((r) => r.standing),
    usedPlayoffResults: false,
    explanations: explain(ranked, ranked, null),
  });

  if (league.status !== LeagueStatus.Complete) {
    return regularSeason();
  }

  try {
    const order = playoffPlacements(standingsMap, ranked, matchups);
    return {
      standings: order.map((r) => r.standing),
      usedPlayoffResults: true,
      explanations: explain(order, ranked, FINISHES),
    };
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "playoff_placement_unavailable",
        year: league.year,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return regularSeason();
  }
}

function explain(order: Ranked[], regular: Ranked[], finishes: Finish[] | null): RankExplanation[] {
  const seedOf = new Map(regular.map((r, i) => [r.standing.userId, i + 1]));
  const pool = regular.map((r) => r.standing);

  return order.map(({ standing: team, aheadOfNext }, i) => {
    const tied = pool.filter((t) => t.wins === team.wins);
    return {
      seed: seedOf.get(team.userId)!,
      aheadOfNext,
      tie:
        tied.length > 1
          ? { size: tied.length, record: recordWithin(team, tied), allPlayed: allPlayed(tied) }
          : null,
      finish: finishes ? (finishes[i] ?? "missedPlayoffs") : null,
    };
  });
}

function playoffPlacements(
  standingsMap: Map<string, Standing>,
  ranked: Ranked[],
  matchups: NewMatchup[],
): Ranked[] {
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
  const byPlayoffs = (userId: string): Ranked => ({
    standing: bySeed(userId),
    aheadOfNext: { by: "playoffs", headToHead: null },
  });

  // The two quarterfinal losers are ranked against each other only, with the
  // same tiebreakers as the regular season.
  const quarterfinalOrder = rankStandings(quarterfinalLosers.map(bySeed));
  quarterfinalOrder[quarterfinalOrder.length - 1]!.aheadOfNext = { by: "playoffs", headToHead: null };

  return [
    byPlayoffs(finalsResult.winner),
    byPlayoffs(finalsResult.loser),
    byPlayoffs(thirdPlaceResult.winner),
    byPlayoffs(thirdPlaceResult.loser),
    ...quarterfinalOrder,
    ...ranked.slice(PLAYOFF_TEAM_COUNT),
  ];
}

// Short reasons for the Discord post, which notes every spot a tiebreaker
// (rather than wins) decided.
function discordTiebreak(c: Comparison): string | null {
  switch (c.by) {
    case "headToHead": {
      const [a, b] = c.headToHead!.records;
      return `head-to-head (${a.wins}-${a.losses} vs ${b.wins}-${b.losses} among the tied teams)`;
    }
    case "headToHeadSweep":
      return "head-to-head (beat every other tied team)";
    case "pointsFor":
      return "points for";
    case "pointsAgainst":
      return "points against";
    case "coinFlip":
      return "a coin flip";
    default:
      return null;
  }
}

export const STANDINGS_URL = "https://ags-hq.org";

export function standingsToDiscordMessage(
  result: LeagueStandings,
  league: League,
  users: UserMap,
): string {
  let b = "";

  if (league.status === LeagueStatus.Complete) {
    b += `**🏆 ${league.year} Final Standings 🏆**\n\n`;
  } else {
    b += `**🏆 ${league.year} Standings 🏆**\n\n`;
  }

  const nameOf = (userId: string) => users.get(userId)?.name || userId;
  const medals = ["🥇", "🥈", "🥉"];
  let anyTiebreak = false;
  result.standings.forEach((st, i) => {
    const rank = medals[i] ?? `${i + 1}.`;

    if (league.status === LeagueStatus.InProgress && i === PLAYOFF_TEAM_COUNT) {
      b += "\n────────────── **Playoffs** ──────────────\n\n";
    }

    b += `${rank} **${nameOf(st.userId)}** - ${st.wins}-${st.losses}-${st.ties} (PF: ${st.pointsFor.toFixed(1)}, PA: ${st.pointsAgainst.toFixed(1)})\n`;

    const next = result.standings[i + 1];
    const aheadOfNext = result.explanations[i]?.aheadOfNext;
    const reason = next && aheadOfNext ? discordTiebreak(aheadOfNext) : null;
    if (next && reason) {
      anyTiebreak = true;
      b += `-# ↳ ahead of ${nameOf(next.userId)} on ${reason}\n`;
    }
  });

  if (anyTiebreak) {
    b +=
      "\n-# Ties on wins: head-to-head (only if every tied team has played the others, or one beat them all), then points for, then points against. " +
      `Full breakdown: <${STANDINGS_URL}>\n`;
  }

  return b;
}
