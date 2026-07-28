import { withTeamNames } from "../data/sleeper";
import { SupabaseClient } from "../data/supabase";
import { PLAYOFF_TEAM_COUNT, Standing, standingsForLeague } from "../domain/standings";
import { League, LeagueStatus, UserMap } from "../domain/types";

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

function jsonResponse(body: unknown, status: number, cacheSeconds = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : "no-store",
    },
  });
}

/**
 * GET /api/standings[?year=YYYY]
 *
 * Reads the same tables the Discord command does. Matchups only land in the
 * database when the weekly recap cron syncs them, so this is as fresh as the
 * last sync, not as fresh as Sleeper.
 */
export async function handleStandingsRequest(db: SupabaseClient, url: URL): Promise<Response> {
  const yearParam = url.searchParams.get("year");
  let year: number | undefined;
  if (yearParam !== null) {
    year = Number(yearParam);
    if (!Number.isInteger(year)) {
      return jsonResponse({ error: "year must be an integer" }, 400);
    }
  }

  // Every database read is inside the catch: a Supabase failure should surface
  // as a JSON error the page can show, not an opaque runtime 500.
  let league: League | null = null;
  try {
    league = year ? await db.getLeagueByYear(year) : await db.getLatestLeague();
    if (!league) {
      return jsonResponse({ error: "league not found" }, 404);
    }

    const matchups = await db.getMatchupsByYear(league.year);
    const { standings, usedPlayoffResults } = standingsForLeague(league, matchups);
    // Team names, not owner names — the same display the recap email uses.
    // For a past season this reads that season's league, so the names are the
    // ones that were in use then.
    const users = await withTeamNames(await db.getUsers(), league.id);
    // Standings only move when the cron syncs, so a few minutes of caching
    // costs nothing and keeps refreshes off Supabase.
    return jsonResponse(standingsPayload(league, standings, users, usedPlayoffResults), 200, 300);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "api_standings_error",
        leagueYear: league?.year ?? null,
        leagueStatus: league?.status ?? null,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return jsonResponse({ error: "could not load standings" }, 500);
  }
}
