import {
  NFLState,
  SleeperLeague,
  getMatchupsForWeek,
  getRostersInLeague,
  getWinnersBracket,
} from "../data/sleeper";
import { SupabaseClient } from "../data/supabase";
import {
  BracketGame,
  PlayoffSettings,
  bracketGamesFrom,
  groupIntoHeadToHead,
  lastCompletedWeek,
  playoffRow,
} from "../domain/sleeperMatchups";
import { matchupsToStandingsMap, sortStandingsMap } from "../domain/standings";
import { Matchup, NewMatchup, PlayoffRound, matchupWinnerAndLoser } from "../domain/types";

// Scores can still change after a week ends (stat corrections), so weeks this
// recent are re-fetched even when we already have their matchups.
const RESYNC_RECENT_WEEKS = 2;

/**
 * The last week Sleeper has finished scoring, as the league reports it.
 *
 * Only a fallback now, for when the schedule endpoint is unreachable: it is
 * late by a week on the day the recap runs, so relying on it means a stale
 * recap rather than none at all.
 */
export function sleeperLastScoredWeek(league: SleeperLeague, state: NFLState): number {
  const scored = league.settings?.last_scored_leg;
  return typeof scored === "number" ? scored : state.week - 1;
}

export type { PlayoffSettings };
export { groupIntoHeadToHead, lastCompletedWeek };

export interface SyncResult {
  weeksFetched: number[];
  inserted: number;
  /** How many of `inserted` were regular season games. */
  regularSeasonInserted: number;
  updated: number;
  /**
   * The season's matchups as they now stand, with inserts and score
   * corrections applied in memory. Returned so callers do not have to read
   * the table back after writing to it.
   */
  matchups: NewMatchup[];
  /**
   * The top three, once the final and third place game are recorded and the
   * week after them is over too (so a late stat correction has had a sync to
   * land in). Null until then.
   */
  podium: Podium | null;
}

export interface Podium {
  first: string;
  second: string;
  third: string;
}

type ScoreUpdate = { id: string; home_score: number; away_score: number };

/**
 * Syncs completed matchups from Sleeper into the database: regular season
 * games from the matchups endpoint, and once the playoffs start, bracket
 * games from the winners bracket.
 *
 * The Go implementation re-fetched every week on every run and issued two
 * queries per matchup, which would exceed the Worker subrequest limit. This
 * version reads existing matchups once, fetches only the weeks that are
 * missing or recent enough to still change, and writes new rows in a single
 * bulk insert.
 *
 * @param playoffs null when the league does not say where its playoffs
 *   start; every week is then treated as regular season
 */
export async function syncLatestData(
  db: SupabaseClient,
  leagueId: string,
  year: number,
  lastCompleteWeek: number,
  existingMatchups: Matchup[],
  playoffs: PlayoffSettings | null = null,
): Promise<SyncResult> {
  const nothing: SyncResult = {
    weeksFetched: [],
    inserted: 0,
    regularSeasonInserted: 0,
    updated: 0,
    matchups: existingMatchups,
    podium: null,
  };
  if (lastCompleteWeek < 1) {
    return nothing;
  }

  const lastRegularWeek = playoffs
    ? Math.min(lastCompleteWeek, playoffs.weekStart - 1)
    : lastCompleteWeek;
  const isRecent = (week: number) => week > lastCompleteWeek - RESYNC_RECENT_WEEKS;

  const weeksWithData = new Set(existingMatchups.filter((m) => !m.is_playoff).map((m) => m.week));

  const regularWeeksToFetch: number[] = [];
  for (let week = 1; week <= lastRegularWeek; week++) {
    if (!weeksWithData.has(week) || isRecent(week)) {
      regularWeeksToFetch.push(week);
    }
  }

  // The bracket is one request and says which playoff weeks are worth
  // fetching, so it is read before anything else whenever the playoffs have
  // started.
  const inPlayoffs = playoffs !== null && lastCompleteWeek >= playoffs.weekStart;
  const bracketGames = inPlayoffs
    ? bracketGamesFrom(await getWinnersBracket(leagueId), playoffs, lastCompleteWeek)
    : [];
  const storedPlayoffRounds = new Map<string, number>();
  for (const m of existingMatchups) {
    if (m.is_playoff && m.playoff_round) {
      storedPlayoffRounds.set(m.playoff_round, (storedPlayoffRounds.get(m.playoff_round) ?? 0) + 1);
    }
  }
  const bracketGamesByRound = new Map<string, number>();
  for (const g of bracketGames) {
    bracketGamesByRound.set(g.round, (bracketGamesByRound.get(g.round) ?? 0) + 1);
  }
  const playoffWeeksToFetch = new Set<number>();
  for (const g of bracketGames) {
    const stored = (storedPlayoffRounds.get(g.round) ?? 0) >= bracketGamesByRound.get(g.round)!;
    if (!stored || g.weeks.some(isRecent)) {
      g.weeks.forEach((w) => playoffWeeksToFetch.add(w));
    }
  }

  const weeksToFetch = [...regularWeeksToFetch, ...[...playoffWeeksToFetch].sort((a, b) => a - b)];
  if (weeksToFetch.length === 0) {
    return { ...nothing, podium: podiumFrom(existingMatchups, bracketGames, lastCompleteWeek) };
  }

  // Only the roster-to-owner mapping is needed here, and Sleeper's rosters
  // endpoint takes no week parameter — it always returns current state. So
  // fetching it per week (as the Go job did) returned identical data every
  // time. Week-specific lineup data lives on the matchups endpoint below.
  const rosters = await getRostersInLeague(leagueId);
  const rosterToOwner = new Map<number, string>();
  for (const roster of rosters) {
    rosterToOwner.set(roster.roster_id, roster.owner_id);
  }

  // Index existing matchups so we can tell inserts from updates without a
  // query per matchup. Regular season games are keyed by week, playoff games
  // by round, since a two-week round is stored once under its first week.
  const existingByKey = new Map<string, Matchup>();
  for (const m of existingMatchups) {
    existingByKey.set(keyOf(m), m);
  }

  const toInsert: NewMatchup[] = [];
  const toUpdate: ScoreUpdate[] = [];
  const upsert = (row: NewMatchup) => {
    const existing =
      existingByKey.get(keyOf(row)) ??
      // The home/away split comes from Sleeper's ordering, which is not
      // stable between runs; check the reverse pairing before inserting.
      existingByKey.get(
        keyOf({ ...row, home_user_id: row.away_user_id, away_user_id: row.home_user_id }),
      );

    if (!existing) {
      toInsert.push(row);
      return;
    }

    const swapped = existing.home_user_id === row.away_user_id;
    const homeScore = swapped ? row.away_score : row.home_score;
    const awayScore = swapped ? row.home_score : row.away_score;

    if (existing.home_score !== homeScore || existing.away_score !== awayScore) {
      toUpdate.push({ id: existing.id, home_score: homeScore, away_score: awayScore });
    }
  };

  const pointsByWeek = new Map<number, Map<number, number>>();
  for (const week of weeksToFetch) {
    const sleeperMatchups = await getMatchupsForWeek(leagueId, week);
    if (playoffWeeksToFetch.has(week)) {
      pointsByWeek.set(week, new Map(sleeperMatchups.map((sm) => [sm.roster_id, sm.points])));
    } else {
      groupIntoHeadToHead(sleeperMatchups, rosterToOwner, year, week).forEach(upsert);
    }
  }

  const regularSeasonInserted = toInsert.length;

  if (playoffWeeksToFetch.size > 0) {
    // Seeds are the regular season ranks the standings page shows, worked out
    // from the regular season as it stands after this sync's writes.
    const regularSeason = applyWrites(existingMatchups, toInsert, toUpdate);
    const seeds = new Map(
      sortStandingsMap(matchupsToStandingsMap(regularSeason)).map((s, i) => [s.userId, i + 1]),
    );

    for (const game of bracketGames) {
      if (game.weeks.every((w) => pointsByWeek.has(w))) {
        const row = playoffRow(game, pointsByWeek, rosterToOwner, seeds, year);
        if (row) upsert(row);
      }
    }
  }

  await db.insertMatchups(toInsert);
  for (const update of toUpdate) {
    await db.updateMatchupScores(update.id, {
      home_score: update.home_score,
      away_score: update.away_score,
    });
  }

  const matchups = applyWrites(existingMatchups, toInsert, toUpdate);
  return {
    weeksFetched: weeksToFetch,
    inserted: toInsert.length,
    regularSeasonInserted,
    updated: toUpdate.length,
    matchups,
    podium: podiumFrom(matchups, bracketGames, lastCompleteWeek),
  };
}

function podiumFrom(
  matchups: NewMatchup[],
  bracketGames: BracketGame[],
  lastCompleteWeek: number,
): Podium | null {
  const final = matchups.find((m) => m.is_playoff && m.playoff_round === PlayoffRound.Finals);
  const third = matchups.find((m) => m.is_playoff && m.playoff_round === PlayoffRound.ThirdPlace);
  const finalWeeks = bracketGames.find((g) => g.round === PlayoffRound.Finals)?.weeks;
  if (!final || !third || !finalWeeks || lastCompleteWeek <= finalWeeks[finalWeeks.length - 1]!) {
    return null;
  }

  const champion = matchupWinnerAndLoser(final);
  const thirdPlace = matchupWinnerAndLoser(third);
  // A tied final has no winner; leave that for a person to settle.
  if (!champion.winner || !thirdPlace.winner) {
    return null;
  }
  return { first: champion.winner, second: champion.loser, third: thirdPlace.winner };
}

// Mirrors the writes above onto the rows we already had, so the caller gets
// the post-sync state without reading the table back.
function applyWrites(
  existingMatchups: Matchup[],
  inserted: NewMatchup[],
  updated: ScoreUpdate[],
): NewMatchup[] {
  const scoresById = new Map(updated.map((u) => [u.id, u]));

  const merged: NewMatchup[] = existingMatchups.map((m) => {
    const update = scoresById.get(m.id);
    return update ? { ...m, home_score: update.home_score, away_score: update.away_score } : m;
  });

  return merged.concat(inserted);
}

function keyOf(m: Pick<NewMatchup, "is_playoff" | "playoff_round" | "week" | "home_user_id" | "away_user_id">): string {
  const when = m.is_playoff ? `playoff:${m.playoff_round}` : `week:${m.week}`;
  return `${when}|${m.home_user_id}|${m.away_user_id}`;
}
