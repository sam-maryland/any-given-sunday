import { getUsersInLeague, teamName } from "../data/sleeper";
import { SupabaseClient } from "../data/supabase";
import { LeagueHistory, buildLeagueHistory } from "../domain/history";
import { lastSyncBoundary } from "../recap/schedule";
import { cachedJsonResponse, epochCacheKey } from "./cache";

export interface HistoryPayload extends LeagueHistory {
  syncedAt: string;
}

// Same reasoning as the standings endpoint: the epoch covers the weekly sync,
// the edge bound covers an out-of-band edit.
const BROWSER_MAX_AGE_SECONDS = 300;
const EDGE_MAX_AGE_SECONDS = 3600;
// Bump whenever HistoryPayload changes shape.
const PAYLOAD_VERSION = "1";

async function loadHistory(db: SupabaseClient, syncedAt: Date): Promise<HistoryPayload> {
  const [leagues, matchups, users] = await Promise.all([
    db.getStartedLeagues(),
    db.getAllMatchups(),
    db.getUsers(),
  ]);

  // Current team names, cosmetic only: owners are named by owner, and a
  // Sleeper outage just leaves the team name off.
  const teamNames = new Map<string, string>();
  const latest = leagues[leagues.length - 1];
  if (latest) {
    try {
      for (const u of await getUsersInLeague(latest.id)) teamNames.set(u.user_id, teamName(u));
    } catch (err) {
      console.warn(
        JSON.stringify({
          event: "team_names_unavailable",
          leagueId: latest.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  return { ...buildLeagueHistory(leagues, matchups, users, teamNames), syncedAt: syncedAt.toISOString() };
}

/**
 * GET /api/history
 *
 * Every owner's career and the league's records, for the history and owner
 * pages. One payload for both: it is a few dozen kilobytes for the whole
 * league, and an owner page needs every other owner's name anyway. Cached on
 * the weekly sync boundary like the standings.
 */
export async function handleHistoryRequest(
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
      load: () => loadHistory(db, syncedAt),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "api_history_error",
        key,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return new Response(JSON.stringify({ error: "could not load the league history" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
}
