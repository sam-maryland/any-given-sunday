import { AGS_FORMAT, formatOf } from "./leagueFormat";
import {
  League,
  LeagueStatus,
  NewMatchup,
  PlayoffPlace,
  PlayoffRound,
  UserMap,
  matchupWinnerAndLoser,
} from "./types";

// Any Given Sunday's playoff field, for the Discord bot and the weekly recap,
// which only ever serve that league. Everything else reads the league's own
// format (see leagueFormat.ts).
export const PLAYOFF_TEAM_COUNT = AGS_FORMAT.playoffTeams;

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

// Builds unsorted per-user standings from regular season matchups. With
// `medianGame`, each team also gets a win or loss each week against the
// week's median score, as Sleeper's league_average_match does; those games
// count toward the record only, not points against or head-to-head.
export function matchupsToStandingsMap(matchups: NewMatchup[], medianGame = false): Map<string, Standing> {
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

  if (medianGame) {
    for (const scores of weeklyScores(matchups).values()) {
      const median = medianOf(scores.map((s) => s.score));
      for (const { userId, score } of scores) {
        const team = ensure(userId);
        if (score > median) team.wins++;
        else if (score < median) team.losses++;
        else team.ties++;
      }
    }
  }

  return standings;
}

function weeklyScores(matchups: NewMatchup[]): Map<number, { userId: string; score: number }[]> {
  const byWeek = new Map<number, { userId: string; score: number }[]>();
  for (const m of matchups) {
    if (m.is_playoff) continue;
    const week = byWeek.get(m.week) ?? [];
    week.push({ userId: m.home_user_id, score: m.home_score }, { userId: m.away_user_id, score: m.away_score });
    byWeek.set(m.week, week);
  }
  return byWeek;
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// The criterion that put one team directly above the next. "headToHeadSweep"
// is a team that beat every other tied team, which counts even when the tied
// teams have not all played each other. "playoffs" means the order came from
// playoff results (or from making the playoffs at all).
//
// "sleeper" is Sleeper's own standings putting one team above another for a
// reason the site cannot see (divisions, say), where wins and points for
// would have had it the other way.
export type Separator =
  | "sleeper"
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
  | "semifinal"
  | "quarterfinal"
  | "firstRound"
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
//
// With `useHeadToHead` false, the order is Sleeper's own rule instead: no
// head-to-head step, and points against goes to the team that allowed *more*
// (https://support.sleeper.com/en/articles/4238872-can-i-set-tiebreakers).
function rankTie(group: Standing[], coin: Map<string, number>, useHeadToHead: boolean): Ranked[] {
  if (group.length === 1) {
    return [{ standing: group[0]!, aheadOfNext: null }];
  }

  const records = new Map(group.map((t) => [t.userId, recordWithin(t, group)]));
  const h2h = (a: Standing, b: Standing, used: boolean): Comparison["headToHead"] => ({
    used,
    records: [records.get(a.userId)!, records.get(b.userId)!],
  });

  const everyonePlayed = useHeadToHead && allPlayed(group);
  const sweep = !useHeadToHead || everyonePlayed ? undefined : sweeper(group);
  if (sweep) {
    const rest = rankTie(
      group.filter((t) => t !== sweep),
      coin,
      useHeadToHead,
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
      (useHeadToHead ? a.pointsAgainst - b.pointsAgainst : b.pointsAgainst - a.pointsAgainst) ||
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
function rankStandings(teams: Standing[], useHeadToHead = true): Ranked[] {
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
    ranked.push(...rankTie(groups.get(wins)!, coin, useHeadToHead));
  }
  return ranked;
}

export function sortStandingsMap(standingsMap: Map<string, Standing>, useHeadToHead = true): Standing[] {
  return rankStandings([...standingsMap.values()], useHeadToHead).map((r) => r.standing);
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

// Computes sorted standings for a league. For a COMPLETE league the playoff
// teams are placed by playoff results instead of regular season record: from
// Sleeper's bracket when the league carries it, else from the stored playoff
// matchups. If those are missing or malformed, falls back to regular season
// order rather than failing the whole command.
export function standingsForLeague(league: League, matchups: NewMatchup[]): LeagueStandings {
  if (league.status === LeagueStatus.Pending) {
    throw new Error("league year has not started yet");
  }

  const format = formatOf(league);
  const standingsMap = matchupsToStandingsMap(matchups, format.medianGame);
  const computed = rankStandings([...standingsMap.values()], format.tiebreaker === "headToHead");
  const ranked =
    format.standings === "sleeper" && league.sleeperRanks ? followSleeper(computed, league.sleeperRanks) : computed;
  const regularSeason = (): LeagueStandings => ({
    standings: ranked.map((r) => r.standing),
    usedPlayoffResults: false,
    explanations: explain(ranked, ranked, null),
  });

  if (league.status !== LeagueStatus.Complete) {
    return regularSeason();
  }

  if (league.playoffOutcome?.length) {
    const { order, finishes } = outcomePlacements(
      ranked,
      league.playoffOutcome,
      format.placementGamesThrough,
      format.tiebreaker === "headToHead",
    );
    return {
      standings: order.map((r) => r.standing),
      usedPlayoffResults: true,
      explanations: explain(order, ranked, finishes),
    };
  }

  try {
    const order = playoffPlacements(standingsMap, ranked, matchups, format.playoffTeams);
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

// The final order from Sleeper's bracket, for any size of playoff field:
// placement games first (the final, the third place game, and any further
// ones the league plays), then the other playoff teams by how far they got,
// and the rest in regular season order. Teams level on all of that keep
// their regular season order.
const ROUND_DEPTH: Record<string, number> = {
  [PlayoffRound.Semifinals]: 3,
  [PlayoffRound.Quarterfinals]: 2,
  [PlayoffRound.FirstRound]: 1,
};

const PLACE_FINISH: Record<number, Finish> = {
  1: "champion",
  2: "runnerUp",
  3: "thirdPlace",
  4: "fourthPlace",
};

const ROUND_FINISH: Record<string, Finish> = {
  [PlayoffRound.Semifinals]: "semifinal",
  [PlayoffRound.Quarterfinals]: "quarterfinal",
  [PlayoffRound.FirstRound]: "firstRound",
};

function outcomePlacements(
  ranked: Ranked[],
  outcome: PlayoffPlace[],
  placementGamesThrough: number | null,
  useHeadToHead: boolean,
): { order: Ranked[]; finishes: Finish[] } {
  const byUser = new Map(ranked.map((r) => [r.standing.userId, r]));
  const counts = (place: number | null) => place !== null && (placementGamesThrough === null || place <= placementGamesThrough);
  const playoff = outcome
    .filter((p) => byUser.has(p.userId))
    .map((p) => (counts(p.place) ? p : { ...p, place: null }));
  const inPlayoffs = new Set(playoff.map((p) => p.userId));
  const viaPlayoffs = (standing: Standing): Ranked => ({ standing, aheadOfNext: { by: "playoffs", headToHead: null } });

  // Placed teams in place order; then the rest by the round they went out
  // in, latest first, each round's teams ranked among themselves.
  const placed = playoff.filter((p) => p.place !== null).sort((a, b) => a.place! - b.place!);
  const rounds = new Map<number, Standing[]>();
  for (const p of playoff) {
    if (p.place !== null) continue;
    const depth = ROUND_DEPTH[p.lostIn ?? ""] ?? 0;
    rounds.set(depth, [...(rounds.get(depth) ?? []), byUser.get(p.userId)!.standing]);
  }
  const order: Ranked[] = placed.map((p) => viaPlayoffs(byUser.get(p.userId)!.standing));
  const finishes: Finish[] = placed.map((p) => PLACE_FINISH[p.place!] ?? ROUND_FINISH[p.lostIn ?? ""] ?? "quarterfinal");
  for (const depth of [...rounds.keys()].sort((a, b) => b - a)) {
    const group = rankStandings(rounds.get(depth)!, useHeadToHead);
    group[group.length - 1]!.aheadOfNext = { by: "playoffs", headToHead: null };
    const lostIn = playoff.find((p) => p.userId === group[0]!.standing.userId)!.lostIn;
    order.push(...group);
    finishes.push(...group.map(() => ROUND_FINISH[lostIn ?? ""] ?? "quarterfinal"));
  }

  order.push(...ranked.filter((r) => !inPlayoffs.has(r.standing.userId)));
  if (order.length === playoff.length) order[order.length - 1]!.aheadOfNext = null;
  return { order, finishes };
}

function playoffPlacements(
  standingsMap: Map<string, Standing>,
  ranked: Ranked[],
  matchups: NewMatchup[],
  playoffTeams: number,
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
    ...ranked.slice(playoffTeams),
  ];
}

// Sleeper's order, when it ranks every team. Where it agrees with the site's
// own ranking (Sleeper's published rule) the site's reasons stand; anywhere
// else the reason is Sleeper's, unless that rule explains the pair anyway.
function followSleeper(computed: Ranked[], ranks: Record<string, number>): Ranked[] {
  if (!computed.every((r) => typeof ranks[r.standing.userId] === "number")) return computed;
  const order = [...computed].sort((a, b) => ranks[a.standing.userId]! - ranks[b.standing.userId]!);
  if (order.every((r, i) => r === computed[i])) return computed;

  const position = new Map(computed.map((r, i) => [r.standing.userId, i]));
  return order.map((r, i) => {
    const next = order[i + 1];
    if (!next) return { standing: r.standing, aheadOfNext: null };
    const upper = r.standing;
    const lower = next.standing;
    const agrees = position.get(upper.userId)! + 1 === position.get(lower.userId)!;
    if (agrees) return r;
    if (upper.wins > lower.wins) return { standing: upper, aheadOfNext: { by: "wins", headToHead: null } };
    if (upper.wins === lower.wins && upper.pointsFor > lower.pointsFor) {
      return { standing: upper, aheadOfNext: { by: "pointsFor", headToHead: null } };
    }
    if (upper.wins === lower.wins && upper.pointsFor === lower.pointsFor && upper.pointsAgainst > lower.pointsAgainst) {
      return { standing: upper, aheadOfNext: { by: "pointsAgainst", headToHead: null } };
    }
    return { standing: upper, aheadOfNext: { by: "sleeper", headToHead: null } };
  });
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

// A link to one season's standings. Pinned to the year rather than the bare
// site, so an old email or Discord post still opens the season it was about
// after the next one starts. The site serves any Sleeper league, so the link
// names this one: its id that season, from which the site finds every
// season before it.
export function standingsUrl(year: number, leagueId: string): string {
  return `${STANDINGS_URL}/?league=${encodeURIComponent(leagueId)}&year=${year}`;
}

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

    if (league.status === LeagueStatus.InProgress && i === formatOf(league).playoffTeams) {
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
      "\n-# Ties on wins: head-to-head (only if every tied team has played the others, or one beat them all), then points for, then points against.\n";
  }
  // Angle brackets stop Discord from unfurling a preview card under the post.
  b += `\n📊 Every game, tiebreak and result: <${standingsUrl(league.year, league.id)}>\n`;

  return b;
}
