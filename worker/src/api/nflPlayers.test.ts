import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { NFL_PLAYERS_KEY, handleNflPlayersRequest } from "./nflPlayers";

/**
 * These run against the real (local) KV binding from wrangler.jsonc, so the
 * stream read is the one production uses.
 */
describe("handleNflPlayersRequest", () => {
  afterEach(() => env.PLAYERS.delete(NFL_PLAYERS_KEY));

  it("serves the stored list as is, cached for a day", async () => {
    const stored = JSON.stringify({ "4046": ["Patrick Mahomes", "QB", "KC"], KC: ["Kansas City Chiefs", "DEF", "KC"] });
    await env.PLAYERS.put(NFL_PLAYERS_KEY, stored);

    const res = await handleNflPlayersRequest(env.PLAYERS);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(await res.text()).toBe(stored);
  });

  it("answers 404 before the first sync has written the list", async () => {
    const res = await handleNflPlayersRequest(env.PLAYERS);
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "player list not available" });
  });

  it("answers 404 when the binding is missing", async () => {
    expect((await handleNflPlayersRequest(undefined)).status).toBe(404);
  });
});
