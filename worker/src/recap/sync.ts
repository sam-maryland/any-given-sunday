import { SleeperMatchup, getMatchupsForWeek, getRostersInLeague } from "../data/sleeper";
import { SupabaseClient } from "../data/supabase";
import { Matchup, NewMatchup } from "../domain/types";

export interface SyncResult {
  weeksFetched: number[];
  inserted: number;
  updated: number;
}

// Scores can still change after a week ends (stat corrections), so weeks this
// recent are re-fetched even when we already have their matchups.
const RESYNC_RECENT_WEEKS = 2;

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
  currentNflWeek: number,
  existingMatchups: Matchup[],
): Promise<SyncResult> {
  // Sleeper's current week is in progress, so the last completed week is the
  // one before it (matching the Go job's `week < nflState.Week` loop).
  const lastCompletedWeek = currentNflWeek - 1;
  if (lastCompletedWeek < 1) {
    return { weeksFetched: [], inserted: 0, updated: 0 };
  }

  const weeksWithData = new Set(existingMatchups.filter((m) => !m.is_playoff).map((m) => m.week));

  const weeksToFetch: number[] = [];
  for (let week = 1; week <= lastCompletedWeek; week++) {
    const isRecent = week > lastCompletedWeek - RESYNC_RECENT_WEEKS;
    if (!weeksWithData.has(week) || isRecent) {
      weeksToFetch.push(week);
    }
  }

  if (weeksToFetch.length === 0) {
    return { weeksFetched: [], inserted: 0, updated: 0 };
  }

  // Fetched once and reused for every week, unlike the Go version which
  // re-fetched rosters inside the per-week loop.
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

  return { weeksFetched: weeksToFetch, inserted: toInsert.length, updated: toUpdate.length };
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
