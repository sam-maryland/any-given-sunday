import { ownerLabels } from "../data/sleeper";
import { SupabaseClient } from "../data/supabase";
import { PlayerHighlights, buildPlayerHighlights } from "../domain/playerHighlights";
import { PlayerHistory, buildPlayerHistory, lookupsFor } from "../domain/playerHistory";
import { Player } from "../domain/types";
import { lastSyncBoundary } from "../recap/schedule";
import { cachedJsonResponse, epochCacheKey } from "./cache";

export interface PlayerPayload extends Omit<PlayerHistory, "ownerIds"> {
  player: Player;
  /**
   * Every owner the events mention, by user id: the name to show (their
   * current Sleeper team name, else Sleeper username, else their own name)
   * and their own name, for a hover.
   */
  owners: Record<string, { label: string; name: string }>;
  syncedAt: string;
}

export interface PlayerHighlightsPayload extends Omit<PlayerHighlights, "ownerIds"> {
  /** Every owner the lists mention, named as in PlayerPayload. */
  owners: Record<string, { label: string; name: string }>;
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
// Bump whenever PlayerPayload, PlayersPayload or PlayerHighlightsPayload changes shape.
const PAYLOAD_VERSION = "3";

// The page shows the first few and reveals the rest on request, so they all
// come in the one cached response: about a month of moves in season.
const RECENT_MOVES = 30;

// Sleeper player ids are digits; a defense's is its team abbreviation.
const PLAYER_ID = /^[A-Za-z0-9]{1,12}$/;

class PlayerNotFound extends Error {}

async function loadPlayer(db: SupabaseClient, playerId: string, syncedAt: Date): Promise<PlayerPayload> {
  const [draftPicks, transactions, rosters, leagues] = await Promise.all([
    db.getDraftPicksForPlayer(playerId),
    db.getPlayerTransactions(playerId),
    db.getAllRosters(),
    db.getStartedLeagues(),
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
  return {
    player: player ?? { id: playerId, name: `Player ${playerId}`, position: null, team: null },
    ...built,
    owners: await ownerNames(db, leagues, ownerIds),
    syncedAt: syncedAt.toISOString(),
  };
}

async function ownerNames(
  db: SupabaseClient,
  leagues: { id: string }[],
  ownerIds: string[],
): Promise<Record<string, { label: string; name: string }>> {
  const [users, labels] = await Promise.all([db.getUsers(), ownerLabels([...leagues].reverse(), ownerIds)]);
  return Object.fromEntries(
    ownerIds.map((id) => {
      const name = users.get(id)?.name || id;
      return [id, { label: labels.get(id) ?? name, name }];
    }),
  );
}

async function loadHighlights(db: SupabaseClient, syncedAt: Date): Promise<PlayerHighlightsPayload> {
  const [transactions, draftPicks, rosters, leagues, players] = await Promise.all([
    db.getAllTransactions(),
    db.getAllDraftPicks(),
    db.getAllRosters(),
    db.getStartedLeagues(),
    db.getAllPlayers(),
  ]);
  const { ownerIds, ...built } = buildPlayerHighlights({
    transactions,
    draftPicks,
    rosters,
    players: new Map(players.map((p) => [p.id, p])),
    startupYear: leagues[0]?.year ?? null,
    recentLimit: RECENT_MOVES,
  });
  return { ...built, owners: await ownerNames(db, leagues, ownerIds), syncedAt: syncedAt.toISOString() };
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

/**
 * GET /api/player-highlights
 *
 * The players page before a search: the latest moves, the longest pick
 * trails, the startup picks who never moved, and the players who have been
 * on the most rosters. Built from every transaction and pick, which is a
 * few hundred rows each; the weekly cache means a miss is rare.
 */
export async function handlePlayerHighlightsRequest(
  db: SupabaseClient,
  url: URL,
  ctx: ExecutionContext,
  now = new Date(),
): Promise<Response> {
  const syncedAt = lastSyncBoundary(now);
  const key = epochCacheKey(url, syncedAt.getTime(), { v: PAYLOAD_VERSION });
  try {
    return await cachedJsonResponse<PlayerHighlightsPayload>({
      key,
      ctx,
      browserMaxAge: BROWSER_MAX_AGE_SECONDS,
      edgeMaxAge: EDGE_MAX_AGE_SECONDS,
      load: () => loadHighlights(db, syncedAt),
    });
  } catch (err) {
    console.error(JSON.stringify({ event: "api_player_highlights_error", key, error: err instanceof Error ? err.message : String(err) }));
    return errorResponse("could not load player highlights", 500);
  }
}
