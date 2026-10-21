import { getUsersInLeague } from "../data/sleeper";
import { SupabaseClient } from "../data/supabase";
import { PlayerHistory, buildPlayerHistory, lookupsFor } from "../domain/playerHistory";
import { Player } from "../domain/types";
import { lastSyncBoundary } from "../recap/schedule";
import { cachedJsonResponse, epochCacheKey } from "./cache";

export interface PlayerPayload extends Omit<PlayerHistory, "ownerIds"> {
  player: Player;
  /** Names for every owner the events mention, by user id. */
  owners: Record<string, string>;
  /**
   * Team names as each season had them: year → user id → name. Only owners
   * who set one are listed; the page falls back to the owner's name.
   */
  teams: Record<string, Record<string, string>>;
  /** The latest season, whose team names are the current ones. */
  currentYear: number | null;
  syncedAt: string;
}

export interface PlayersPayload {
  /** Everyone who has been through the league, by name. */
  players: Player[];
  syncedAt: string;
}

// Same reasoning as the standings endpoint: the epoch covers the weekly sync,
// the edge bound covers an out-of-band edit — and the player names, which the
// sync-players Action writes two hours after the epoch.
const BROWSER_MAX_AGE_SECONDS = 300;
const EDGE_MAX_AGE_SECONDS = 3600;
// Bump whenever PlayerPayload or PlayersPayload changes shape.
const PAYLOAD_VERSION = "2";

// Sleeper player ids are digits; a defense's is its team abbreviation.
const PLAYER_ID = /^[A-Za-z0-9]{1,12}$/;

class PlayerNotFound extends Error {}

async function loadPlayer(db: SupabaseClient, playerId: string, syncedAt: Date): Promise<PlayerPayload> {
  const [draftPicks, transactions, rosters, leagues, users] = await Promise.all([
    db.getDraftPicksForPlayer(playerId),
    db.getPlayerTransactions(playerId),
    db.getAllRosters(),
    db.getStartedLeagues(),
    db.getUsers(),
  ]);
  const { playerIds, pickSlots } = lookupsFor(transactions);
  const [named, pickResults] = await Promise.all([
    db.getPlayersByIds([...new Set([playerId, ...playerIds])]),
    db.getDraftPicksBySlots(pickSlots),
  ]);
  const players = new Map(named.map((p) => [p.id, p]));
  for (const p of pickResults) {
    if (!players.has(p.player_id)) players.set(p.player_id, { id: p.player_id, name: p.player_name, position: p.position, team: null });
  }

  // A player who arrived since the last name sync still has a history; one
  // with neither a name nor a move was never in the league.
  const drafted = draftPicks[0];
  const player =
    players.get(playerId) ?? (drafted ? { id: playerId, name: drafted.player_name, position: drafted.position, team: null } : undefined);
  if (!player && transactions.length === 0) throw new PlayerNotFound(playerId);

  const { ownerIds, ...built } = buildPlayerHistory({
    playerId,
    draftPicks,
    transactions,
    rosters,
    startupYear: leagues[0]?.year ?? null,
    players,
    pickResults,
  });
  const currentYear = leagues[leagues.length - 1]?.year ?? null;
  const years = new Set<number>(currentYear === null ? [] : [currentYear]);
  for (const e of built.events) {
    years.add(e.year);
    if (e.kind === "drafted") for (const l of e.pickTrades) years.add(l.year);
  }
  return {
    player: player ?? { id: playerId, name: `Player ${playerId}`, position: null, team: null },
    ...built,
    owners: Object.fromEntries(ownerIds.map((id) => [id, users.get(id)?.name || id])),
    teams: await teamNames(leagues.filter((l) => years.has(l.year))),
    currentYear,
    syncedAt: syncedAt.toISOString(),
  };
}

/**
 * Each season's team names, read from Sleeper, which keeps them per league.
 * One request per season the history touches. Cosmetic, like the history
 * page's: a season Sleeper can't serve just falls back to owner names.
 */
async function teamNames(leagues: { id: string; year: number }[]): Promise<Record<string, Record<string, string>>> {
  const teams: Record<string, Record<string, string>> = {};
  const results = await Promise.allSettled(leagues.map((l) => getUsersInLeague(l.id)));
  results.forEach((r, i) => {
    const league = leagues[i]!;
    if (r.status === "rejected") {
      console.warn(JSON.stringify({ event: "team_names_unavailable", leagueId: league.id, error: String(r.reason) }));
      return;
    }
    const named = r.value.filter((u) => u.metadata?.team_name).map((u): [string, string] => [u.user_id, u.metadata!.team_name!]);
    if (named.length) teams[league.year] = Object.fromEntries(named);
  });
  return teams;
}

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * GET /api/player?id=<sleeper player id>
 *
 * One player's path through the league, for the player page. Loads only that
 * player's rows — a few transactions and picks — rather than every
 * transaction, which keeps a miss well inside the free plan's CPU budget.
 */
export async function handlePlayerRequest(db: SupabaseClient, url: URL, ctx: ExecutionContext, now = new Date()): Promise<Response> {
  const id = url.searchParams.get("id") ?? "";
  // Checked before it reaches the cache key or a query.
  if (!PLAYER_ID.test(id)) return errorResponse("id must be a Sleeper player id", 400);

  const syncedAt = lastSyncBoundary(now);
  const key = epochCacheKey(url, syncedAt.getTime(), { id, v: PAYLOAD_VERSION });
  try {
    return await cachedJsonResponse({
      key,
      ctx,
      browserMaxAge: BROWSER_MAX_AGE_SECONDS,
      edgeMaxAge: EDGE_MAX_AGE_SECONDS,
      load: () => loadPlayer(db, id, syncedAt),
    });
  } catch (err) {
    if (err instanceof PlayerNotFound) return errorResponse("player not found", 404);
    console.error(JSON.stringify({ event: "api_player_error", key, error: err instanceof Error ? err.message : String(err) }));
    return errorResponse("could not load this player", 500);
  }
}

/**
 * GET /api/players
 *
 * Every player who has been through the league, for the search box: a few
 * dozen kilobytes, sorted by name.
 */
export async function handlePlayersRequest(db: SupabaseClient, url: URL, ctx: ExecutionContext, now = new Date()): Promise<Response> {
  const syncedAt = lastSyncBoundary(now);
  const key = epochCacheKey(url, syncedAt.getTime(), { v: PAYLOAD_VERSION });
  try {
    return await cachedJsonResponse<PlayersPayload>({
      key,
      ctx,
      browserMaxAge: BROWSER_MAX_AGE_SECONDS,
      edgeMaxAge: EDGE_MAX_AGE_SECONDS,
      load: async () => ({
        players: (await db.getAllPlayers()).sort((a, b) => a.name.localeCompare(b.name)),
        syncedAt: syncedAt.toISOString(),
      }),
    });
  } catch (err) {
    console.error(JSON.stringify({ event: "api_players_error", key, error: err instanceof Error ? err.message : String(err) }));
    return errorResponse("could not load players", 500);
  }
}
