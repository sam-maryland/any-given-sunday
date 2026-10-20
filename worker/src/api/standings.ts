import { withTeamNames } from "../data/sleeper";
import { SupabaseClient } from "../data/supabase";
import {
  Finish,
  LeagueStandings,
  PLAYOFF_TEAM_COUNT,
  RankExplanation,
  standingsForLeague,
} from "../domain/standings";
import { League, LeagueStatus, NewMatchup, UserMap } from "../domain/types";
import { lastSyncBoundary } from "../recap/schedule";
import { cachedJsonResponse, epochCacheKey } from "./cache";

export interface GameRow {
  week: number;
  opponentId: string;
  pointsFor: number;
  pointsAgainst: number;
  result: "W" | "L" | "T";
  /** The playoff round, for a playoff game. */
  playoffRound: string | null;
}

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
  /** Regular season rank: the playoff seed for the top six. */
  seed: number;
  /** Why this team is directly above the next one; null for last place. */
  aheadOfNext: RankExplanation["aheadOfNext"];
  /** The regular season win tie this team was part of, if any. */
  tie: RankExplanation["tie"];
  /** How a completed season ended, when playoff results set the order. */
  finish: Finish | null;
  /** Every game this season in week order, playoffs included. */
  games: GameRow[];
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
  /** Seeds at or above this get a first-round bye. */
  byeCutoff: number;
  /** The latest week with a synced game, or null before week 1 lands. */
  throughWeek: number | null;
  /** When the weekly sync this data reflects ran, as an ISO timestamp. */
  syncedAt: string;
  /** Seasons with standings, newest first, for the season picker. */
  seasons: number[];
  standings: StandingsRow[];
}

export interface PayloadInput {
  league: League;
  matchups: NewMatchup[];
  result: LeagueStandings;
  users: UserMap;
  seasons: number[];
  syncedAt: Date;
}

export const BYE_SEEDS = 2;

function gamesByUser(matchups: NewMatchup[]): Map<string, GameRow[]> {
  const games = new Map<string, GameRow[]>();
  const add = (userId: string, game: GameRow) => {
    const list = games.get(userId);
    if (list) list.push(game);
    else games.set(userId, [game]);
  };
  const outcome = (mine: number, theirs: number): GameRow["result"] =>
    mine > theirs ? "W" : mine < theirs ? "L" : "T";

  for (const m of [...matchups].sort((a, b) => a.week - b.week)) {
    const playoffRound = m.is_playoff ? m.playoff_round : null;
    add(m.home_user_id, {
      week: m.week,
      opponentId: m.away_user_id,
      pointsFor: round1(m.home_score),
      pointsAgainst: round1(m.away_score),
      result: outcome(m.home_score, m.away_score),
      playoffRound,
    });
    add(m.away_user_id, {
      week: m.week,
      opponentId: m.home_user_id,
      pointsFor: round1(m.away_score),
      pointsAgainst: round1(m.home_score),
      result: outcome(m.away_score, m.home_score),
      playoffRound,
    });
  }
  return games;
}

// The browser-facing view of the same standings the /standings command posts,
// plus the working behind them: the dashboard explains each team's place.
export function standingsPayload(input: PayloadInput): StandingsPayload {
  const { league, matchups, result, users } = input;
  const games = gamesByUser(matchups);
  const weeks = matchups.map((m) => m.week);

  return {
    year: league.year,
    status: league.status,
    usedPlayoffResults: result.usedPlayoffResults,
    playoffCutoff: league.status === LeagueStatus.InProgress ? PLAYOFF_TEAM_COUNT : null,
    byeCutoff: BYE_SEEDS,
    throughWeek: weeks.length > 0 ? Math.max(...weeks) : null,
    syncedAt: input.syncedAt.toISOString(),
    seasons: input.seasons,
    standings: result.standings.map((s, i) => {
      const why = result.explanations[i]!;
      return {
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
        seed: why.seed,
        aheadOfNext: why.aheadOfNext,
        tie: why.tie,
        finish: why.finish,
        games: games.get(s.userId) ?? [],
      };
    }),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// How long a browser may reuse the standings, and how long the edge may. The
// epoch key handles the weekly sync; the edge bound is the safety net for an
// out-of-band edit, such as a commissioner tagging playoff results by hand.
const BROWSER_MAX_AGE_SECONDS = 300;
// Part of the cache key. Bump it whenever StandingsPayload changes shape, so a
// deploy never serves the new page a payload cached by the old code.
const PAYLOAD_VERSION = "2";
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

  const [matchups, seasons] = await Promise.all([
    db.getMatchupsByYear(league.year),
    db.getSeasonYears(),
  ]);
  const result = standingsForLeague(league, matchups);
  // Team names, not owner names — the same display the recap email uses.
  // For a past season this reads that season's league, so the names are the
  // ones that were in use then.
  const users = await withTeamNames(await db.getUsers(), league.id);

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
