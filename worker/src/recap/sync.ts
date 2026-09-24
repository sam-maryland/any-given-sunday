import {
  NFLState,
  SleeperGame,
  SleeperLeague,
  SleeperMatchup,
  getMatchupsForWeek,
  getRostersInLeague,
} from "../data/sleeper";
import { SupabaseClient } from "../data/supabase";
import { Matchup, NewMatchup } from "../domain/types";

export interface SyncResult {
  weeksFetched: number[];
  inserted: number;
  updated: number;
  /**
   * The season's matchups as they now stand, with inserts and score
   * corrections applied in memory. Returned so callers do not have to read
   * the table back after writing to it.
   */
  matchups: NewMatchup[];
}

// Scores can still change after a week ends (stat corrections), so weeks this
// recent are re-fetched even when we already have their matchups.
const RESYNC_RECENT_WEEKS = 2;

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

/**
 * Syncs completed regular season matchups from Sleeper into the database.
 *
 * The Go implementation re-fetched every week on every run and issued two
 * queries per matchup, which would exceed the Worker subrequest limit. This
 * version reads existing matchups once, fetches only the weeks that are
 * missing or recent enough to still change, and writes new rows in a single
 * bulk insert.
 */
export async function syncLatestData(
  db: SupabaseClient,
  leagueId: string,
  year: number,
  lastCompleteWeek: number,
  existingMatchups: Matchup[],
): Promise<SyncResult> {
  if (lastCompleteWeek < 1) {
    return { weeksFetched: [], inserted: 0, updated: 0, matchups: existingMatchups };
  }

  const weeksWithData = new Set(existingMatchups.filter((m) => !m.is_playoff).map((m) => m.week));

  const weeksToFetch: number[] = [];
  for (let week = 1; week <= lastCompleteWeek; week++) {
    const isRecent = week > lastCompleteWeek - RESYNC_RECENT_WEEKS;
    if (!weeksWithData.has(week) || isRecent) {
      weeksToFetch.push(week);
    }
  }

  if (weeksToFetch.length === 0) {
    return { weeksFetched: [], inserted: 0, updated: 0, matchups: existingMatchups };
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

  // Index existing regular season matchups so we can tell inserts from updates
  // without a query per matchup.
  const existingByKey = new Map<string, Matchup>();
  for (const m of existingMatchups) {
    if (!m.is_playoff) {
      existingByKey.set(matchupKey(m.week, m.home_user_id, m.away_user_id), m);
    }
  }

  const toInsert: NewMatchup[] = [];
  const toUpdate: { id: string; home_score: number; away_score: number }[] = [];

  for (const week of weeksToFetch) {
    const sleeperMatchups = await getMatchupsForWeek(leagueId, week);
    const pairs = groupIntoHeadToHead(sleeperMatchups, rosterToOwner, year, week);

    for (const pair of pairs) {
      const existing =
        existingByKey.get(matchupKey(week, pair.home_user_id, pair.away_user_id)) ??
        // The home/away split comes from Sleeper's ordering, which is not
        // stable between runs; check the reverse pairing before inserting.
        existingByKey.get(matchupKey(week, pair.away_user_id, pair.home_user_id));

      if (!existing) {
        toInsert.push(pair);
        continue;
      }

      const swapped = existing.home_user_id === pair.away_user_id;
      const homeScore = swapped ? pair.away_score : pair.home_score;
      const awayScore = swapped ? pair.home_score : pair.away_score;

      if (existing.home_score !== homeScore || existing.away_score !== awayScore) {
        toUpdate.push({ id: existing.id, home_score: homeScore, away_score: awayScore });
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

  return {
    weeksFetched: weeksToFetch,
    inserted: toInsert.length,
    updated: toUpdate.length,
    matchups: applyWrites(existingMatchups, toInsert, toUpdate),
  };
}

// Mirrors the writes above onto the rows we already had, so the caller gets
// the post-sync state without reading the table back.
function applyWrites(
  existingMatchups: Matchup[],
  inserted: NewMatchup[],
  updated: { id: string; home_score: number; away_score: number }[],
): NewMatchup[] {
  const scoresById = new Map(updated.map((u) => [u.id, u]));

  const merged: NewMatchup[] = existingMatchups.map((m) => {
    const update = scoresById.get(m.id);
    return update ? { ...m, home_score: update.home_score, away_score: update.away_score } : m;
  });

  return merged.concat(inserted);
}

function matchupKey(week: number, userA: string, userB: string): string {
  return `${week}|${userA}|${userB}`;
}

/**
 * Sleeper returns one row per team; rows sharing a matchup_id are opponents.
 * Bye weeks (no matchup_id) and incomplete pairings are skipped rather than
 * failing the whole sync.
 */
function groupIntoHeadToHead(
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
