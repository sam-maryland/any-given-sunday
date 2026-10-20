import { getLeague, getMatchupsForWeek, getRostersInLeague } from "../data/sleeper";
import { SupabaseClient } from "../data/supabase";
import { Pairing } from "../domain/playoffRace";
import { PLAYOFF_TEAM_COUNT } from "../domain/standings";
import { LeagueStatus } from "../domain/types";
import { groupIntoHeadToHead } from "../recap/sync";
import { lastSyncBoundary } from "../recap/schedule";
import { cachedJsonResponse, epochCacheKey } from "./cache";
import { BYE_SEEDS } from "./standings";

/** A regular season game already played, at full scoring precision. */
export interface PlayedGame {
  week: number;
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
}

export type PlayoffRacePayload =
  | { active: false; reason: string }
  | {
      active: true;
      year: number;
      /** The latest synced regular season week, or 0 before week 1 lands. */
      throughWeek: number;
      lastRegularWeek: number;
      playoffTeams: number;
      byeTeams: number;
      /**
       * Played games with unrounded scores. The standings payload rounds to
       * one decimal for display, which is not precise enough to settle a
       * points-for tiebreak the way the real standings do.
       */
      played: PlayedGame[];
      remaining: Pairing[];
      syncedAt: string;
    };

// Same reasoning as the standings endpoint: the epoch covers the weekly sync,
// the edge bound covers an out-of-band edit.
const BROWSER_MAX_AGE_SECONDS = 300;
const EDGE_MAX_AGE_SECONDS = 3600;
// Bump whenever PlayoffRacePayload changes shape.
const PAYLOAD_VERSION = "1";

async function loadPlayoffRace(db: SupabaseClient, syncedAt: Date): Promise<PlayoffRacePayload> {
  const league = await db.getLatestLeague();
  if (!league || league.status !== LeagueStatus.InProgress) {
    return { active: false, reason: "no season in progress" };
  }

  const settings = (await getLeague(league.id)).settings;
  const playoffStart = settings?.playoff_week_start;
  if (typeof playoffStart !== "number") {
    return { active: false, reason: "the league does not say when its playoffs start" };
  }
  const lastRegularWeek = playoffStart - 1;

  const played = (await db.getMatchupsByYear(league.year)).filter((m) => !m.is_playoff);
  const throughWeek = played.reduce((max, m) => Math.max(max, m.week), 0);
  if (throughWeek >= lastRegularWeek) {
    return { active: false, reason: "the regular season is over" };
  }

  // Sleeper publishes every regular season week's pairings up front, with
  // zero points until the games are played. One request per week left, at
  // most once per sync thanks to the cache.
  const rosters = await getRostersInLeague(league.id);
  const rosterToOwner = new Map(rosters.map((r) => [r.roster_id, r.owner_id]));
  const remaining: Pairing[] = [];
  for (let week = throughWeek + 1; week <= lastRegularWeek; week++) {
    for (const m of groupIntoHeadToHead(await getMatchupsForWeek(league.id, week), rosterToOwner, league.year, week)) {
      remaining.push({ week, homeId: m.home_user_id, awayId: m.away_user_id });
    }
  }

  return {
    active: true,
    year: league.year,
    throughWeek,
    lastRegularWeek,
    playoffTeams: PLAYOFF_TEAM_COUNT,
    byeTeams: BYE_SEEDS,
    played: played.map((m) => ({
      week: m.week,
      homeId: m.home_user_id,
      awayId: m.away_user_id,
      homeScore: m.home_score,
      awayScore: m.away_score,
    })),
    remaining,
    syncedAt: syncedAt.toISOString(),
  };
}

/**
 * GET /api/playoff-race
 *
 * What the dashboard needs to simulate the rest of the current season: the
 * games played so far and the pairings still to come. The simulation itself
 * runs in the browser (see domain/playoffRace.ts for why). Cached on the
 * weekly sync boundary like the standings, so a hit costs no Supabase or
 * Sleeper requests.
 */
export async function handlePlayoffRaceRequest(
  db: SupabaseClient,
  url: URL,
  ctx: ExecutionContext,
  now = new Date(),
): Promise<Response> {
  const syncedAt = lastSyncBoundary(now);
  const key = epochCacheKey(url, syncedAt.getTime(), { v: PAYLOAD_VERSION });

  try {
    return await cachedJsonResponse({
      key,
      ctx,
      browserMaxAge: BROWSER_MAX_AGE_SECONDS,
      edgeMaxAge: EDGE_MAX_AGE_SECONDS,
      load: () => loadPlayoffRace(db, syncedAt),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "api_playoff_race_error",
        key,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return new Response(JSON.stringify({ error: "could not load the playoff race" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
}
