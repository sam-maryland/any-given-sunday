// The KV key scripts/sync-players.ts writes.
export const NFL_PLAYERS_KEY = "nfl-players";

// The list changes weekly at most, and a day-old team is harmless.
const MAX_AGE_SECONDS = 86400;

/**
 * GET /api/nfl-players
 *
 * Every NFL player as { [id]: [name, position, team] }, so the browser can
 * name the players in any league's transactions. Sleeper's own list is
 * ~15 MB; the weekly sync-players Action trims it and stores it in KV. It is
 * passed through as a stream, never parsed: parsing a few megabytes of JSON
 * would blow the free plan's 10 ms of CPU.
 */
export async function handleNflPlayersRequest(kv: KVNamespace | undefined): Promise<Response> {
  const body = await kv?.get(NFL_PLAYERS_KEY, "stream");
  if (!body) {
    return new Response(JSON.stringify({ error: "player list not available" }), {
      status: 404,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  return new Response(body, {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${MAX_AGE_SECONDS}` },
  });
}
