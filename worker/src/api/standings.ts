import { withTeamNames } from "../data/sleeper";
import { SupabaseClient } from "../data/supabase";
import { PLAYOFF_TEAM_COUNT, Standing, standingsForLeague } from "../domain/standings";
import { League, LeagueStatus, UserMap } from "../domain/types";
import { lastSyncBoundary } from "../recap/schedule";
import { createMemo } from "./cache";

export interface StandingsRow {
  rank: number;
  userId: string;
  /** Sleeper team name, falling back to the stored user name. */
  name: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface StandingsPayload {
  year: number;
  status: string;
  /**
   * False when a COMPLETE season's order is regular season record only,
   * because its playoff matchups are missing. The dashboard shows the same
   * caveat the Discord command does.
   */
  usedPlayoffResults: boolean;
  /** Teams above this index are in playoff position, while a season is live. */
  playoffCutoff: number | null;
  standings: StandingsRow[];
}

// The browser-facing view of the same standings the /standings command posts.
export function standingsPayload(
  league: League,
  standings: Standing[],
  users: UserMap,
  usedPlayoffResults: boolean,
): StandingsPayload {
  return {
    year: league.year,
    status: league.status,
    usedPlayoffResults,
    playoffCutoff: league.status === LeagueStatus.InProgress ? PLAYOFF_TEAM_COUNT : null,
    standings: standings.map((s, i) => ({
      rank: i + 1,
      userId: s.userId,
      name: users.get(s.userId)?.name || s.userId,
      wins: s.wins,
      losses: s.losses,
      ties: s.ties,
      // Raw sums carry float noise from summing scores; round to the one
      // decimal place fantasy scoring actually has.
      pointsFor: round1(s.pointsFor),
      pointsAgainst: round1(s.pointsAgainst),
    })),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function jsonResponse(
  body: unknown,
  status: number,
  extra?: { cacheSeconds?: number; hit?: boolean },
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": extra?.cacheSeconds
      ? `public, max-age=${extra.cacheSeconds}`
      : "no-store",
  };
  if (extra?.hit !== undefined) {
    headers["X-Cache"] = extra.hit ? "HIT" : "MISS";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

// Thrown rather than returned so the miss never reaches the cache: an empty
// database should not pin a 404 for the rest of the week.
class LeagueNotFound extends Error {}

const standingsCache = createMemo();

async function loadStandings(
  db: SupabaseClient,
  year: number | undefined,
): Promise<StandingsPayload> {
  const league = year ? await db.getLeagueByYear(year) : await db.getLatestLeague();
  if (!league) {
    throw new LeagueNotFound(`no league for ${year ?? "latest"}`);
  }

  const matchups = await db.getMatchupsByYear(league.year);
  const { standings, usedPlayoffResults } = standingsForLeague(league, matchups);
  // Team names, not owner names — the same display the recap email uses.
  // For a past season this reads that season's league, so the names are the
  // ones that were in use then.
  const users = await withTeamNames(await db.getUsers(), league.id);

  return standingsPayload(league, standings, users, usedPlayoffResults);
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
  now = new Date(),
): Promise<Response> {
  const yearParam = url.searchParams.get("year");
  let year: number | undefined;
  if (yearParam !== null) {
    year = Number(yearParam);
    if (!Number.isInteger(year)) {
      return jsonResponse({ error: "year must be an integer" }, 400);
    }
  }

  const key = `standings:${year ?? "latest"}`;
  const epoch = lastSyncBoundary(now).getTime();

  // Every read is inside the catch: a Supabase failure should surface as a
  // JSON error the page can show, not an opaque runtime 500.
  try {
    const { value, hit } = await standingsCache(key, epoch, now.getTime(), () =>
      loadStandings(db, year),
    );
    return jsonResponse(value, 200, { cacheSeconds: 300, hit });
  } catch (err) {
    if (err instanceof LeagueNotFound) {
      return jsonResponse({ error: "league not found" }, 404);
    }
    console.error(
      JSON.stringify({
        event: "api_standings_error",
        key,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return jsonResponse({ error: "could not load standings" }, 500);
  }
}
