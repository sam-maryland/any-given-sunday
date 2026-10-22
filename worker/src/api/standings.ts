import { ownerLabels } from "../data/sleeper";
import { SupabaseClient } from "../data/supabase";
import { StandingsPayload, standingsPayload } from "../domain/payloads";
import { standingsForLeague } from "../domain/standings";
import { UserMap } from "../domain/types";
import { lastSyncBoundary } from "../recap/schedule";
import { cachedJsonResponse, epochCacheKey } from "./cache";

export type { GameRow, StandingsPayload, StandingsRow } from "../domain/payloads";
export { BYE_SEEDS, standingsPayload } from "../domain/payloads";

// How long a browser may reuse the standings, and how long the edge may. The
// epoch key handles the weekly sync; the edge bound is the safety net for an
// out-of-band edit, such as a commissioner tagging playoff results by hand.
const BROWSER_MAX_AGE_SECONDS = 300;
// Part of the cache key. Bump it whenever StandingsPayload changes shape, so a
// deploy never serves the new page a payload cached by the old code.
const PAYLOAD_VERSION = "3";
const EDGE_MAX_AGE_SECONDS = 3600;

function errorResponse(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Thrown rather than returned so the miss never reaches the cache: an empty
// database should not pin a 404 for the rest of the week.
class LeagueNotFound extends Error {}

async function loadStandings(
  db: SupabaseClient,
  year: number | undefined,
  syncedAt: Date,
): Promise<StandingsPayload> {
  const league = year ? await db.getLeagueByYear(year) : await db.getLatestLeague();
  if (!league) {
    throw new LeagueNotFound(`no league for ${year ?? "latest"}`);
  }

  const [matchups, seasons, leagues, stored] = await Promise.all([
    db.getMatchupsByYear(league.year),
    db.getSeasonYears(),
    db.getStartedLeagues(),
    db.getUsers(),
  ]);
  const result = standingsForLeague(league, matchups);
  // Owners go by what the site calls them everywhere: their current team
  // name, else Sleeper username, else their own name. A past season shows
  // today's names too, so a team reads the same on every page.
  const labels = await ownerLabels(
    [...leagues].reverse(),
    result.standings.map((s) => s.userId),
  );
  const users: UserMap = new Map(
    [...stored].map(([id, u]) => [id, { ...u, name: labels.get(id) ?? u.name }]),
  );

  return standingsPayload({ league, matchups, result, users, seasons, syncedAt });
}

/**
 * GET /api/standings[?year=YYYY]
 *
 * Reads the same tables the Discord command does. Matchups only land in the
 * database when the weekly recap cron syncs them, so this is as fresh as the
 * last sync, not as fresh as Sleeper — and cached on exactly that boundary,
 * so a hit costs no Supabase or Sleeper requests at all.
 */
export async function handleStandingsRequest(
  db: SupabaseClient,
  url: URL,
  ctx: ExecutionContext,
  now = new Date(),
): Promise<Response> {
  const yearParam = url.searchParams.get("year");
  let year: number | undefined;
  if (yearParam !== null) {
    year = Number(yearParam);
    // Bounded as well as integral: the year is part of the cache key, and each
    // distinct value costs a full set of Supabase and Sleeper reads to miss.
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return errorResponse("year must be an integer between 2000 and 2100", 400);
    }
  }

  const syncedAt = lastSyncBoundary(now);
  const key = epochCacheKey(url, syncedAt.getTime(), {
    year: year ? String(year) : "latest",
    v: PAYLOAD_VERSION,
  });

  // Every read is inside the catch: a Supabase failure should surface as a
  // JSON error the page can show, not an opaque runtime 500.
  try {
    return await cachedJsonResponse({
      key,
      ctx,
      browserMaxAge: BROWSER_MAX_AGE_SECONDS,
      edgeMaxAge: EDGE_MAX_AGE_SECONDS,
      load: () => loadStandings(db, year, syncedAt),
    });
  } catch (err) {
    if (err instanceof LeagueNotFound) {
      return errorResponse("league not found", 404);
    }
    console.error(
      JSON.stringify({
        event: "api_standings_error",
        key,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return errorResponse("could not load standings", 500);
  }
}
