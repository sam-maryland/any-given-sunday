import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handlePlayoffRaceRequest } from "./playoffRace";
import { SupabaseClient } from "../data/supabase";
import { League, LeagueStatus, Matchup } from "../domain/types";

function league(status: string): League {
  return { id: "L1", year: 2026, first_place: "", second_place: "", third_place: "", status };
}

let nextId = 0;
function game(week: number, home: string, away: string, homeScore: number, awayScore: number): Matchup {
  return {
    id: `m${nextId++}`,
    year: 2026,
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

function fakeDb(l: League | null, matchups: Matchup[]) {
  return {
    getLatestLeague: async () => l,
    getMatchupsByYear: async () => matchups,
  } as unknown as SupabaseClient;
}

// Sleeper, with playoffs from week 4: weeks 2 and 3 are still to play.
let sleeperCalls: string[];
function stubSleeper(playoffWeekStart = 4) {
  sleeperCalls = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    sleeperCalls.push(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.endsWith("/league/L1")) return json({ league_id: "L1", status: "in_season", settings: { playoff_week_start: playoffWeekStart } });
    if (url.endsWith("/league/L1/rosters")) return json([1, 2, 3, 4].map((id) => ({ roster_id: id, owner_id: `u${id}` })));
    const week = url.match(/\/matchups\/(\d+)$/)?.[1];
    if (week) {
      // Week 2: 1v3, 2v4. Week 3: 1v4, 2v3.
      const pairs = week === "2" ? [[1, 3], [2, 4]] : [[1, 4], [2, 3]];
      return json(pairs.flatMap(([a, b], i) => [
        { matchup_id: i + 1, roster_id: a, points: 0 },
        { matchup_id: i + 1, roster_id: b, points: 0 },
      ]));
    }
    return new Response("not found", { status: 404 });
  });
}

// Each test uses its own sync week, so cached entries never collide.
async function request(db: SupabaseClient, now: Date) {
  const ctx = createExecutionContext();
  const res = await handlePlayoffRaceRequest(db, new URL("https://ags-hq.org/api/playoff-race"), ctx, now);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("handlePlayoffRaceRequest", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.unstubAllGlobals());

  it("returns played games at full precision and the pairings still to come", async () => {
    stubSleeper();
    const db = fakeDb(league(LeagueStatus.InProgress), [game(1, "u1", "u2", 101.37, 99.12), game(1, "u3", "u4", 88, 90)]);

    const body = await (await request(db, new Date("2026-09-15T12:00:00Z"))).json<any>();

    expect(body).toMatchObject({ active: true, year: 2026, throughWeek: 1, lastRegularWeek: 3, playoffTeams: 6, byeTeams: 2 });
    expect(body.played[0]).toEqual({ week: 1, homeId: "u1", awayId: "u2", homeScore: 101.37, awayScore: 99.12 });
    expect(body.remaining).toEqual([
      { week: 2, homeId: "u1", awayId: "u3" },
      { week: 2, homeId: "u2", awayId: "u4" },
      { week: 3, homeId: "u1", awayId: "u4" },
      { week: 3, homeId: "u2", awayId: "u3" },
    ]);
  });

  it("serves a repeat request without calling Sleeper again", async () => {
    stubSleeper();
    const db = fakeDb(league(LeagueStatus.InProgress), [game(1, "u1", "u2", 1, 0)]);
    const now = new Date("2026-09-22T12:00:00Z");

    await request(db, now);
    const calls = sleeperCalls.length;
    const second = await request(db, now);

    expect(second.headers.get("X-Cache")).toBe("HIT");
    expect(sleeperCalls.length).toBe(calls);
  });

  it("is inactive outside a season in progress", async () => {
    stubSleeper();
    const body = await (await request(fakeDb(league(LeagueStatus.Complete), []), new Date("2026-09-29T12:00:00Z"))).json<any>();

    expect(body.active).toBe(false);
    expect(sleeperCalls).toEqual([]);
  });

  it("is inactive once the regular season is over", async () => {
    stubSleeper(2);
    const db = fakeDb(league(LeagueStatus.InProgress), [game(1, "u1", "u2", 1, 0)]);

    const body = await (await request(db, new Date("2026-10-06T12:00:00Z"))).json<any>();

    expect(body).toEqual({ active: false, reason: "the regular season is over" });
  });

  it("does not cache a Sleeper failure", async () => {
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    const db = fakeDb(league(LeagueStatus.InProgress), [game(1, "u1", "u2", 1, 0)]);
    const now = new Date("2026-10-13T12:00:00Z");

    expect((await request(db, now)).status).toBe(500);

    stubSleeper();
    expect((await request(db, now)).status).toBe(200);
  });
});
