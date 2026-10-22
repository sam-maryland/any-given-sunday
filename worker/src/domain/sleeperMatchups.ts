import { SleeperBracketMatch, SleeperGame, SleeperMatchup } from "../data/sleeper";
import { NewMatchup, PlayoffPlace, PlayoffRound } from "./types";

// Turns Sleeper's matchup and bracket payloads into the matchup rows the
// standings and history are built from. Shared by the weekly recap, which
// stores them, and the website, which builds them in the browser.

// A game that can still be played blocks its week. "canceled" cannot be
// played, so it counts as finished — week 6 of the 2026 season already
// carries one, and waiting on it would stall the recap for the rest of the
// year. Anything else, including whatever Sleeper reports mid-game, holds.
const FINISHED_GAME_STATUSES = new Set(["complete", "canceled"]);

/**
 * The last week whose games are all over, according to the NFL schedule.
 *
 * Two earlier versions of this asked Sleeper's counters instead —
 * `NFLState.week - 1`, then the league's `last_scored_leg` — and both were
 * wrong in the same way: those counters advance on Sleeper's own weekly
 * rollover, which lands after the Tuesday the recap runs. Each shipped as a
 * fix and each produced another silent Tuesday, because on the morning the
 * job runs they still describe the week that finished the night before as
 * unfinished.
 *
 * The games themselves have no such ambiguity. This walks up from week 1 and
 * stops at the first week still holding a playable game, so a week is only
 * ever reported complete when every week before it is too.
 *
 * @param fallback used when the schedule is unavailable — see the caller
 */
export function lastCompletedWeek(schedule: SleeperGame[], fallback: number): number {
  if (schedule.length === 0) {
    return fallback;
  }

  const byWeek = new Map<number, SleeperGame[]>();
  for (const game of schedule) {
    const games = byWeek.get(game.week);
    if (games) {
      games.push(game);
    } else {
      byWeek.set(game.week, [game]);
    }
  }

  let lastComplete = 0;
  for (let week = 1; byWeek.has(week); week++) {
    const games = byWeek.get(week) as SleeperGame[];
    if (!games.every((g) => FINISHED_GAME_STATUSES.has(g.status))) {
      break;
    }
    lastComplete = week;
  }

  return lastComplete;
}

export interface PlayoffSettings {
  /** The first playoff week; everything before it is regular season. */
  weekStart: number;
  /** Sleeper's playoff_round_type — see SleeperLeague.settings. */
  roundType: number;
}

/** A bracket game whose teams are known and whose weeks are all over. */
export interface BracketGame {
  round: string;
  /** The weeks the game is played over; scores are summed across them. */
  weeks: number[];
  t1: number;
  t2: number;
}

// The NFL weeks each playoff round is played over. Rounds are numbered from 1.
export function roundWeeks(round: number, finalRound: number, playoffs: PlayoffSettings): number[] {
  switch (playoffs.roundType) {
    case 2: {
      const first = playoffs.weekStart + 2 * (round - 1);
      return [first, first + 1];
    }
    case 1: {
      const first = playoffs.weekStart + round - 1;
      return round === finalRound ? [first, first + 1] : [first];
    }
    default:
      return [playoffs.weekStart + round - 1];
  }
}

/** A game between teams that already lost: it decides a place, not the title. */
export function isConsolation(g: SleeperBracketMatch): boolean {
  return g.t1_from?.l !== undefined || g.t2_from?.l !== undefined;
}

// Bracket rounds counted back from the last one. Only the bracket proper,
// the final and the third place game are recorded: the fifth place game and
// the losers bracket are left out, since every playoff row counts toward
// playoff wins in career_stats.
export function roundFromFinal(roundsBeforeFinal: number): string | undefined {
  if (roundsBeforeFinal === 0) return PlayoffRound.Finals;
  if (roundsBeforeFinal === 1) return PlayoffRound.Semifinals;
  if (roundsBeforeFinal === 2) return PlayoffRound.Quarterfinals;
  if (roundsBeforeFinal > 2) return PlayoffRound.FirstRound;
  return undefined;
}

/**
 * The bracket games ready to record: both teams known, and every week of the
 * round complete. A two-week final is not recorded after its first week,
 * since half its score would read as a final result.
 */
export function bracketGamesFrom(
  bracket: SleeperBracketMatch[],
  playoffs: PlayoffSettings,
  lastCompleteWeek: number,
): BracketGame[] {
  const finalRound = bracket.reduce((max, g) => Math.max(max, g.r), 0);
  const games: BracketGame[] = [];

  for (const g of bracket) {
    let round: string | undefined;
    if (g.p === 1) {
      round = PlayoffRound.Finals;
    } else if (g.p === 3) {
      round = PlayoffRound.ThirdPlace;
    } else if (g.p === undefined && !isConsolation(g)) {
      round = roundFromFinal(finalRound - g.r);
    }
    if (!round || g.t1 === null || g.t2 === null) {
      continue;
    }

    const weeks = roundWeeks(g.r, finalRound, playoffs);
    if (weeks[weeks.length - 1]! > lastCompleteWeek) {
      continue;
    }
    games.push({ round, weeks, t1: g.t1, t2: g.t2 });
  }

  return games;
}

export function playoffRow(
  game: BracketGame,
  pointsByWeek: Map<number, Map<number, number>>,
  rosterToOwner: Map<number, string>,
  seeds: Map<string, number>,
  year: number,
): NewMatchup | null {
  const home = rosterToOwner.get(game.t1);
  const away = rosterToOwner.get(game.t2);
  if (!home || !away) {
    console.warn(
      JSON.stringify({ event: "sync_skipped_matchup", reason: "roster has no owner", round: game.round }),
    );
    return null;
  }

  const total = (rosterId: number) =>
    // Rounded to the hundredth Sleeper scores in, so summing two weeks does
    // not leave float noise like 341.90000000000003 in the table.
    Math.round(game.weeks.reduce((sum, w) => sum + (pointsByWeek.get(w)!.get(rosterId) ?? 0), 0) * 100) / 100;

  return {
    year,
    week: game.weeks[0]!,
    is_playoff: true,
    playoff_round: game.round,
    home_user_id: home,
    away_user_id: away,
    home_seed: seeds.get(home) ?? null,
    away_seed: seeds.get(away) ?? null,
    home_score: total(game.t1),
    away_score: total(game.t2),
  };
}


/**
 * Sleeper returns one row per team; rows sharing a matchup_id are opponents.
 * Bye weeks (no matchup_id) and incomplete pairings are skipped rather than
 * failing the whole sync.
 */
export function groupIntoHeadToHead(
  sleeperMatchups: SleeperMatchup[],
  rosterToOwner: Map<number, string>,
  year: number,
  week: number,
): NewMatchup[] {
  const groups = new Map<number, SleeperMatchup[]>();
  for (const sm of sleeperMatchups) {
    if (!sm.matchup_id) {
      continue;
    }
    const group = groups.get(sm.matchup_id);
    if (group) {
      group.push(sm);
    } else {
      groups.set(sm.matchup_id, [sm]);
    }
  }

  const pairs: NewMatchup[] = [];
  for (const [matchupId, teams] of groups) {
    if (teams.length !== 2) {
      console.warn(
        JSON.stringify({
          event: "sync_skipped_matchup",
          reason: "expected 2 teams",
          week,
          matchupId,
          teamCount: teams.length,
        }),
      );
      continue;
    }

    const [home, away] = teams as [SleeperMatchup, SleeperMatchup];
    const homeOwner = rosterToOwner.get(home.roster_id);
    const awayOwner = rosterToOwner.get(away.roster_id);
    if (!homeOwner || !awayOwner) {
      console.warn(
        JSON.stringify({
          event: "sync_skipped_matchup",
          reason: "roster has no owner",
          week,
          matchupId,
        }),
      );
      continue;
    }

    pairs.push({
      year,
      week,
      is_playoff: false,
      playoff_round: null,
      home_user_id: homeOwner,
      away_user_id: awayOwner,
      home_seed: null,
      away_seed: null,
      home_score: home.points,
      away_score: away.points,
    });
  }

  return pairs;
}

/**
 * How every playoff team finished, read from the winners bracket: a
 * placement game (`p`) puts its winner in place p and its loser in p + 1;
 * anyone else is known by the round they lost in. Null until the final has
 * a winner.
 */
export function playoffOutcome(
  bracket: SleeperBracketMatch[],
  rosterToOwner: Map<number, string>,
): PlayoffPlace[] | null {
  const final = bracket.find((g) => g.p === 1);
  if (!final || final.w === null || final.l === null) return null;

  const finalRound = bracket.reduce((max, g) => Math.max(max, g.r), 0);
  const places = new Map<number, number>();
  const lostIn = new Map<number, string>();
  const teams = new Set<number>();
  // Round order, so a team's first loss is the one it went out in; anything
  // after that was a consolation game.
  for (const g of [...bracket].sort((a, b) => a.r - b.r)) {
    if (g.t1 !== null) teams.add(g.t1);
    if (g.t2 !== null) teams.add(g.t2);
    if (g.w === null || g.l === null) continue;
    if (g.p !== undefined) {
      places.set(g.w, g.p);
      places.set(g.l, g.p + 1);
    }
    if (!isConsolation(g) && !lostIn.has(g.l)) {
      const round = roundFromFinal(finalRound - g.r);
      if (round && round !== PlayoffRound.Finals) lostIn.set(g.l, round);
    }
  }

  const outcome: PlayoffPlace[] = [];
  for (const rosterId of teams) {
    const userId = rosterToOwner.get(rosterId);
    if (!userId) continue;
    outcome.push({ userId, place: places.get(rosterId) ?? null, lostIn: lostIn.get(rosterId) ?? null });
  }
  return outcome.sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity));
}
