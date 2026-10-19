import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleStandingsRequest, standingsPayload } from "./standings";
import { SupabaseClient } from "../data/supabase";
import { standingsForLeague } from "../domain/standings";
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

function users(...ids: string[]): UserMap {
  return new Map(
    ids.map((id): [string, User] => [
      id,
      { id, name: `Team ${id.toUpperCase()}`, discord_id: null, onboarding_complete: true, email: null },
    ]),
  );
}

let nextId = 0;
function game(week: number, home: string, away: string, homeScore: number, awayScore: number): Matchup {
  return {
    id: `m${nextId++}`,
    year: 2025,
    week,
    is_playoff: false,
    playoff_round: null,
    home_user_id: home,
    away_user_id: away,
    home_seed: null,
    away_seed: null,
    home_score: homeScore,
    away_score: awayScore,
  };
}

const SYNCED_AT = new Date("2025-10-14T11:00:00Z");

function payloadFor(status: string, matchups: Matchup[], userMap = users("a", "b", "c")) {
  const l = league(status);
  return standingsPayload({
    league: l,
    matchups,
    result: standingsForLeague(l, matchups),
    users: userMap,
    seasons: [2025, 2024],
    syncedAt: SYNCED_AT,
  });
}

describe("standingsPayload", () => {
  const season = [
    game(1, "a", "b", 120.5, 100),
    game(2, "a", "c", 110, 90.25),
    game(3, "b", "c", 0.1 + 0.2, 0),
  ];

  it("ranks teams in domain order and resolves names", () => {
    const payload = payloadFor(LeagueStatus.InProgress, season);

    expect(payload.standings.map((s) => [s.rank, s.name])).toEqual([
      [1, "Team A"],
      [2, "Team B"],
      [3, "Team C"],
    ]);
    expect(payload.standings[0]).toMatchObject({
      wins: 2,
      losses: 0,
      pointsFor: 230.5,
      pointsAgainst: 190.3,
      seed: 1,
    });
  });

  it("falls back to the user id when the user row is missing", () => {
    const payload = payloadFor(LeagueStatus.InProgress, [game(1, "ghost", "b", 1, 0)], users("b"));

    expect(payload.standings[0]!.name).toBe("ghost");
  });

  it("rounds away float drift from summed scores", () => {
    const payload = payloadFor(LeagueStatus.InProgress, season);

    expect(payload.standings[1]!.pointsFor).toBe(100.3);
  });

  it("explains which criterion separates each team from the next", () => {
    const payload = payloadFor(LeagueStatus.InProgress, season);

    expect(payload.standings.map((s) => s.aheadOfNext?.by ?? null)).toEqual([
      "wins",
      "wins",
      null,
    ]);
  });

  it("lists each team's games in week order from its own side", () => {
    const payload = payloadFor(LeagueStatus.InProgress, season);
    const c = payload.standings.find((s) => s.userId === "c")!;

    expect(c.games).toEqual([
      { week: 2, opponentId: "a", pointsFor: 90.3, pointsAgainst: 110, result: "L", playoffRound: null },
      { week: 3, opponentId: "b", pointsFor: 0, pointsAgainst: 0.3, result: "L", playoffRound: null },
    ]);
  });

  it("reports the latest synced week, the sync time, and the season list", () => {
    const payload = payloadFor(LeagueStatus.InProgress, season);

    expect(payload.throughWeek).toBe(3);
    expect(payload.syncedAt).toBe(SYNCED_AT.toISOString());
    expect(payload.seasons).toEqual([2025, 2024]);
    expect(payloadFor(LeagueStatus.InProgress, []).throughWeek).toBeNull();
  });

  it("marks the playoff cut line only while a season is in progress", () => {
    expect(payloadFor(LeagueStatus.InProgress, season).playoffCutoff).toBe(6);
    expect(payloadFor(LeagueStatus.Complete, season).playoffCutoff).toBeNull();
  });

  it("passes through the playoff-results caveat for completed seasons", () => {
    const payload = payloadFor(LeagueStatus.Complete, season);

    expect(payload.status).toBe(LeagueStatus.Complete);
    expect(payload.usedPlayoffResults).toBe(false);
    expect(payload.standings[0]!.finish).toBeNull();
  });
});

// The endpoint holds one module-scope cache, so these tests use a distinct
// year per case to keep their cache keys from colliding.
const AFTER_SYNC = new Date("2026-07-28T12:00:00Z"); // Tuesday, after 11:00 UTC
const NEXT_WEEK = new Date("2026-08-04T12:00:00Z");

function fakeDb(league: League | null, matchups: Matchup[] = []) {
  const calls = { league: 0, matchups: 0, users: 0, seasons: 0 };
  const db = {
    getLatestLeague: async () => (calls.league++, league),
    getLeagueByYear: async () => (calls.league++, league),
    getMatchupsByYear: async () => (calls.matchups++, matchups),
    getUsers: async () => (calls.users++, users("a")),
    getSeasonYears: async () => (calls.seasons++, [2025]),
  } as unknown as SupabaseClient;
  return { db, calls };
}

// Runs against the real caches.default. Cache writes go through waitUntil, so
// they must settle before the next request can be expected to hit.
async function request(db: SupabaseClient, year: number | "latest", now: Date) {
  const ctx = createExecutionContext();
  const res = await handleStandingsRequest(
    db,
    new URL(`https://ags-hq.org/api/standings${year === "latest" ? "" : `?year=${year}`}`),
    ctx,
    now,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

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
    expect(calls).toEqual({ league: 1, matchups: 1, users: 1, seasons: 1 });
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
      new URL("https://ags-hq.org/api/standings?year=abc"),
      createExecutionContext(),
      AFTER_SYNC,
    );

    expect(res.status).toBe(400);
    expect(calls.league).toBe(0);
  });
});
