import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleHistoryRequest } from "./history";
import { SupabaseClient } from "../data/supabase";
import { League, LeagueStatus, Matchup, User } from "../domain/types";

const leagues: League[] = [
  { id: "L2025", year: 2025, status: LeagueStatus.InProgress, first_place: "", second_place: "", third_place: "" },
];
const matchups: Matchup[] = [
  {
    id: "m1",
    year: 2025,
    week: 1,
    is_playoff: false,
    playoff_round: null,
    home_user_id: "a",
    away_user_id: "b",
    home_seed: null,
    away_seed: null,
    home_score: 110,
    away_score: 90,
  },
];

function fakeDb() {
  const calls = { matchups: 0 };
  const db = {
    getStartedLeagues: async () => leagues,
    getAllMatchups: async () => (calls.matchups++, matchups),
    getUsers: async () =>
      new Map(
        ["a", "b"].map((id): [string, User] => [
          id,
          { id, name: `Owner ${id}`, discord_id: null, onboarding_complete: null, email: null },
        ]),
      ),
  } as unknown as SupabaseClient;
  return { db, calls };
}

async function request(db: SupabaseClient, now: Date) {
  const ctx = createExecutionContext();
  const res = await handleHistoryRequest(db, new URL("https://ags-hq.org/api/history"), ctx, now);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("handleHistoryRequest", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("adds current team names, and serves a repeat from cache", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify([{ user_id: "a", username: "a", display_name: "A", metadata: { team_name: "The Aces" } }])),
    );
    const { db, calls } = fakeDb();
    const now = new Date("2026-09-15T12:00:00Z");

    const body = await (await request(db, now)).json<any>();
    const second = await request(db, now);

    expect(body.owners.find((o: any) => o.userId === "a")).toMatchObject({ name: "Owner a", teamName: "The Aces", slug: "owner-a" });
    expect(body.syncedAt).toBe("2026-09-15T11:00:00.000Z");
    expect(second.headers.get("X-Cache")).toBe("HIT");
    expect(calls.matchups).toBe(1);
  });

  it("still answers when Sleeper is down, without team names", async () => {
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    const { db } = fakeDb();

    const res = await request(db, new Date("2026-09-22T12:00:00Z"));
    const body = await res.json<any>();

    expect(res.status).toBe(200);
    expect(body.owners.every((o: any) => o.teamName === null)).toBe(true);
  });

  it("does not cache a database failure", async () => {
    const failing = {
      getStartedLeagues: async () => {
        throw new Error("supabase down");
      },
      getAllMatchups: async () => [],
      getUsers: async () => new Map(),
    } as unknown as SupabaseClient;
    const now = new Date("2026-09-29T12:00:00Z");

    expect((await request(failing, now)).status).toBe(500);
    vi.stubGlobal("fetch", async () => new Response("[]"));
    expect((await request(fakeDb().db, now)).status).toBe(200);
  });
});
