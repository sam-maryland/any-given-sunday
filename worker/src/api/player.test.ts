import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handlePlayerRequest, handlePlayersRequest } from "./player";
import { SupabaseClient } from "../data/supabase";
import { DraftPick, League, LeagueStatus, Player, Transaction, User } from "../domain/types";

const leagues: League[] = [
  { id: "L2023", year: 2023, status: LeagueStatus.Complete, first_place: "", second_place: "", third_place: "" },
  { id: "L2024", year: 2024, status: LeagueStatus.InProgress, first_place: "", second_place: "", third_place: "" },
];
const players: Player[] = [
  { id: "100", name: "Rookie Receiver", position: "WR", team: "CAR" },
  { id: "200", name: "Veteran Back", position: "RB", team: null },
];
const draftPick: DraftPick = {
  draft_id: "D2024",
  league_id: "L2024",
  year: 2024,
  pick_no: 3,
  round: 1,
  draft_slot: 3,
  original_roster_id: 1,
  roster_id: 1,
  player_id: "100",
  player_name: "Rookie Receiver",
  position: "WR",
};
const trade: Transaction = {
  id: "t1",
  league_id: "L2024",
  year: 2024,
  week: 3,
  type: "trade",
  status: "complete",
  roster_ids: [1, 2],
  adds: { "100": 2, "200": 1 },
  drops: { "100": 1, "200": 2 },
  draft_picks: [],
  waiver_budget: [],
  created_at: "2024-09-20T00:00:00Z",
  completed_at: "2024-09-20T00:00:00Z",
};

function fakeDb(known = true) {
  const calls = { transactions: 0, lookedUp: [] as string[][] };
  const db = {
    getDraftPicksForPlayer: async (id: string) => (known && id === "100" ? [draftPick] : []),
    getPlayerTransactions: async (id: string) => (calls.transactions++, known && id === "100" ? [trade] : []),
    getAllRosters: async () => [
      { league_id: "L2024", roster_id: 1, user_id: "a" },
      { league_id: "L2024", roster_id: 2, user_id: "b" },
    ],
    getStartedLeagues: async () => leagues,
    getUsers: async () =>
      new Map(["a", "b"].map((id): [string, User] => [id, { id, name: `Owner ${id}`, discord_id: null, onboarding_complete: null, email: null }])),
    getPlayersByIds: async (ids: string[]) => (calls.lookedUp.push(ids), known ? players.filter((p) => ids.includes(p.id)) : []),
    getDraftPicksBySlots: async () => [],
    getAllPlayers: async () => [...players].reverse(),
  } as unknown as SupabaseClient;
  return { db, calls };
}

async function get(handler: typeof handlePlayerRequest, db: SupabaseClient, path: string, now = new Date("2026-10-21T12:00:00Z")) {
  const ctx = createExecutionContext();
  const res = await handler(db, new URL(`https://ags-hq.org${path}`), ctx, now);
  await waitOnExecutionContext(ctx);
  return res;
}

// Sleeper's users for each league. b's team was renamed for 2024; a never
// set a team name; with `bLeft`, b is gone from the 2024 league.
function stubSleeper({ down = false, bLeft = false } = {}) {
  const requested: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (down) return new Response("down", { status: 503 });
    const year = url.includes("/L2023/") ? 2023 : 2024;
    const users = [
      { user_id: "a", username: "a", display_name: "aaa", metadata: {} },
      { user_id: "b", username: "b", display_name: "bbb", metadata: { team_name: year === 2023 ? "Old Name" : "New Name" } },
    ];
    return new Response(JSON.stringify(bLeft && year === 2024 ? users.slice(0, 1) : users));
  });
  return requested;
}

describe("handlePlayerRequest", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns the player's path with every owner it mentions named, and caches it per player", async () => {
    const requested = stubSleeper();
    const { db, calls } = fakeDb();
    const now = new Date("2026-09-15T12:00:00Z");
    const body = await (await get(handlePlayerRequest, db, "/api/player?id=100", now)).json<any>();
    const again = await get(handlePlayerRequest, db, "/api/player?id=100", now);

    expect(body.player).toEqual(players[0]);
    expect(body.events.map((e: any) => e.kind)).toEqual(["drafted", "traded"]);
    expect(body.events[1]).toMatchObject({ fromId: "a", toId: "b", receivedFor: [{ kind: "player", id: "200", name: "Veteran Back" }] });
    expect(body.currentOwnerId).toBe("b");
    // Today's team name, else the Sleeper username; read from the latest
    // league alone when everyone is still in it.
    expect(body.owners).toEqual({ a: { label: "aaa", name: "Owner a" }, b: { label: "New Name", name: "Owner b" } });
    expect(requested).toEqual(["https://api.sleeper.app/v1/league/L2024/users"]);
    expect(body.events[0].startup).toBe(false);
    expect(calls.lookedUp[0]).toEqual(["100", "200"]);
    expect(again.headers.get("X-Cache")).toBe("HIT");
    expect(calls.transactions).toBe(1);
  });

  it("names an owner who has left by the last season they played", async () => {
    const requested = stubSleeper({ bLeft: true });
    const body = await (await get(handlePlayerRequest, fakeDb().db, "/api/player?id=100", new Date("2026-10-13T12:00:00Z"))).json<any>();
    expect(body.owners.b).toEqual({ label: "Old Name", name: "Owner b" });
    expect(requested).toHaveLength(2);
  });

  it("still answers when Sleeper is down, with owners' own names", async () => {
    stubSleeper({ down: true });
    const res = await get(handlePlayerRequest, fakeDb().db, "/api/player?id=100", new Date("2026-10-06T12:00:00Z"));
    expect(res.status).toBe(200);
    expect((await res.json<any>()).owners.a).toEqual({ label: "Owner a", name: "Owner a" });
  });

  it("answers 404 for someone who was never in the league, and does not cache it", async () => {
    const { db, calls } = fakeDb(false);
    expect((await get(handlePlayerRequest, db, "/api/player?id=999")).status).toBe(404);
    expect((await get(handlePlayerRequest, db, "/api/player?id=999")).status).toBe(404);
    expect(calls.transactions).toBe(2);
  });

  it("rejects an id that is not a Sleeper player id before it reaches a query", async () => {
    const { db, calls } = fakeDb();
    for (const id of ["", "1,2", "a(b)", "x".repeat(13)]) {
      expect((await get(handlePlayerRequest, db, `/api/player?id=${encodeURIComponent(id)}`)).status).toBe(400);
    }
    expect(calls.transactions).toBe(0);
  });

  it("reports a database failure as a 500", async () => {
    const { db } = fakeDb();
    (db as any).getPlayerTransactions = async () => {
      throw new Error("supabase down");
    };
    expect((await get(handlePlayerRequest, db, "/api/player?id=100", new Date("2026-09-29T12:00:00Z"))).status).toBe(500);
  });
});

describe("handlePlayersRequest", () => {
  it("lists everyone who has been through the league by name", async () => {
    const body = await (await get(handlePlayersRequest, fakeDb().db, "/api/players")).json<any>();
    expect(body.players.map((p: Player) => p.name)).toEqual(["Rookie Receiver", "Veteran Back"]);
  });
});
