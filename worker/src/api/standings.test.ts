import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleStandingsRequest, standingsPayload } from "./standings";
import { SupabaseClient } from "../data/supabase";
import { Standing } from "../domain/standings";
import { League, LeagueStatus, Matchup, User, UserMap } from "../domain/types";

function league(status: string): League {
  return {
    id: "L1",
    year: 2025,
    first_place: "",
    second_place: "",
    third_place: "",
    status,
  };
}

function standing(userId: string, overrides: Partial<Standing> = {}): Standing {
  return {
    userId,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    h2hWins: new Map(),
    ...overrides,
  };
}

function users(...ids: string[]): UserMap {
  return new Map(
    ids.map((id): [string, User] => [
      id,
      { id, name: `Team ${id.toUpperCase()}`, discord_id: null, onboarding_complete: true, email: null },
    ]),
  );
}

describe("standingsPayload", () => {
  it("ranks teams in the order the domain sorted them and resolves names", () => {
    const payload = standingsPayload(
      league(LeagueStatus.InProgress),
      [
        standing("a", { wins: 3, losses: 1, pointsFor: 400.5, pointsAgainst: 380.2 }),
        standing("b", { wins: 2, losses: 2, ties: 1 }),
      ],
      users("a", "b"),
      false,
    );

    expect(payload.standings.map((s) => [s.rank, s.name])).toEqual([
      [1, "Team A"],
      [2, "Team B"],
    ]);
    expect(payload.standings[0]).toMatchObject({
      wins: 3,
      losses: 1,
      pointsFor: 400.5,
      pointsAgainst: 380.2,
    });
  });

  it("falls back to the user id when the user row is missing", () => {
    const payload = standingsPayload(
      league(LeagueStatus.InProgress),
      [standing("ghost")],
      users(),
      false,
    );

    expect(payload.standings[0]!.name).toBe("ghost");
  });

  it("rounds away float drift from summed scores", () => {
    const payload = standingsPayload(
      league(LeagueStatus.InProgress),
      [standing("a", { pointsFor: 0.1 + 0.2, pointsAgainst: 100.04 })],
      users("a"),
      false,
    );

    expect(payload.standings[0]!.pointsFor).toBe(0.3);
    expect(payload.standings[0]!.pointsAgainst).toBe(100);
  });

  it("marks the playoff cut line only while a season is in progress", () => {
    const live = standingsPayload(league(LeagueStatus.InProgress), [], users(), false);
    expect(live.playoffCutoff).toBe(6);

    const done = standingsPayload(league(LeagueStatus.Complete), [], users(), true);
    expect(done.playoffCutoff).toBeNull();
  });

  it("passes through the playoff-results caveat for completed seasons", () => {
    const payload = standingsPayload(league(LeagueStatus.Complete), [], users(), false);

    expect(payload.status).toBe(LeagueStatus.Complete);
    expect(payload.usedPlayoffResults).toBe(false);
  });
});

// The endpoint holds one module-scope cache, so these tests use a distinct
// year per case to keep their cache keys from colliding.
const AFTER_SYNC = new Date("2026-07-28T12:00:00Z"); // Tuesday, after 11:00 UTC
const NEXT_WEEK = new Date("2026-08-04T12:00:00Z");

function fakeDb(league: League | null, matchups: Matchup[] = []) {
  const calls = { league: 0, matchups: 0, users: 0 };
  const db = {
    getLatestLeague: async () => (calls.league++, league),
    getLeagueByYear: async () => (calls.league++, league),
    getMatchupsByYear: async () => (calls.matchups++, matchups),
    getUsers: async () => (calls.users++, users("a")),
  } as unknown as SupabaseClient;
  return { db, calls };
}

const request = (db: SupabaseClient, year: number | "latest", now: Date) =>
  handleStandingsRequest(
    db,
    new URL(`https://x/api/standings${year === "latest" ? "" : `?year=${year}`}`),
    now,
  );

describe("handleStandingsRequest caching", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    // withTeamNames calls Sleeper; let it fail so it falls back to DB names.
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("serves a repeat request from cache without touching the database", async () => {
    const { db, calls } = fakeDb(league(LeagueStatus.InProgress));

    const first = await request(db, 2001, AFTER_SYNC);
    const second = await request(db, 2001, AFTER_SYNC);

    expect(first.headers.get("X-Cache")).toBe("MISS");
    expect(second.headers.get("X-Cache")).toBe("HIT");
    expect(calls).toEqual({ league: 1, matchups: 1, users: 1 });
    expect(await second.json()).toEqual(await first.json());
  });

  it("reloads once the weekly sync boundary has passed", async () => {
    const { db, calls } = fakeDb(league(LeagueStatus.InProgress));

    await request(db, 2002, AFTER_SYNC);
    const next = await request(db, 2002, NEXT_WEEK);

    expect(next.headers.get("X-Cache")).toBe("MISS");
    expect(calls.matchups).toBe(2);
  });

  it("caches each season separately", async () => {
    const { db, calls } = fakeDb(league(LeagueStatus.InProgress));

    await request(db, 2003, AFTER_SYNC);
    await request(db, 2004, AFTER_SYNC);

    expect(calls.matchups).toBe(2);
    expect((await request(db, 2003, AFTER_SYNC)).headers.get("X-Cache")).toBe("HIT");
  });

  it("does not cache a missing league", async () => {
    const { db } = fakeDb(null);

    const missing = await request(db, 2005, AFTER_SYNC);
    expect(missing.status).toBe(404);

    // The league now exists; the earlier 404 must not be pinned for the week.
    const { db: found } = fakeDb(league(LeagueStatus.InProgress));
    const ok = await request(found, 2005, AFTER_SYNC);
    expect(ok.status).toBe(200);
  });

  it("does not cache a database failure", async () => {
    const failing = {
      getLeagueByYear: async () => {
        throw new Error("supabase down");
      },
    } as unknown as SupabaseClient;

    expect((await request(failing, 2006, AFTER_SYNC)).status).toBe(500);

    const { db } = fakeDb(league(LeagueStatus.InProgress));
    expect((await request(db, 2006, AFTER_SYNC)).status).toBe(200);
  });

  it("rejects a non-integer year before doing any work", async () => {
    const { db, calls } = fakeDb(league(LeagueStatus.InProgress));

    const res = await handleStandingsRequest(
      db,
      new URL("https://x/api/standings?year=abc"),
      AFTER_SYNC,
    );

    expect(res.status).toBe(400);
    expect(calls.league).toBe(0);
  });
});
