import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseClient } from "../data/supabase";
import { SleeperGame, SleeperLeague } from "../data/sleeper";
import { Matchup, NewMatchup } from "../domain/types";
import { lastCompletedWeek, sleeperLastScoredWeek, syncLatestData } from "./sync";

const ROSTERS = [
  { roster_id: 1, owner_id: "u1" },
  { roster_id: 2, owner_id: "u2" },
  { roster_id: 3, owner_id: "u3" },
  { roster_id: 4, owner_id: "u4" },
];

// One Sleeper week: two head-to-head games plus a bye row that must be ignored.
function weekPayload(scores: [number, number, number, number]) {
  return [
    { matchup_id: 1, roster_id: 1, points: scores[0] },
    { matchup_id: 1, roster_id: 2, points: scores[1] },
    { matchup_id: 2, roster_id: 3, points: scores[2] },
    { matchup_id: 2, roster_id: 4, points: scores[3] },
    { matchup_id: null, roster_id: 99, points: 0 },
  ];
}

let fetchCalls: string[];
let inserted: NewMatchup[];
let updated: { id: string; home_score: number; away_score: number }[];
let db: SupabaseClient;

beforeEach(() => {
  fetchCalls = [];
  inserted = [];
  updated = [];

  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchCalls.push(url);
    if (url.includes("/rosters")) {
      return new Response(JSON.stringify(ROSTERS));
    }
    if (url.includes("/matchups/")) {
      return new Response(JSON.stringify(weekPayload([100, 90, 80, 70])));
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  db = {
    insertMatchups: async (rows: NewMatchup[]) => {
      if (rows.length > 0) {
        fetchCalls.push("supabase:insertMatchups");
        inserted.push(...rows);
      }
    },
    updateMatchupScores: async (
      id: string,
      scores: { home_score: number; away_score: number },
    ) => {
      fetchCalls.push("supabase:updateMatchupScores");
      updated.push({ id, ...scores });
    },
  } as unknown as SupabaseClient;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function existing(overrides: Partial<Matchup> & Pick<Matchup, "week">): Matchup {
  return {
    id: `existing-${overrides.week}`,
    year: 2025,
    is_playoff: false,
    playoff_round: null,
    home_user_id: "u1",
    away_user_id: "u2",
    home_seed: null,
    away_seed: null,
    home_score: 100,
    away_score: 90,
    ...overrides,
  };
}

// Statuses as the schedule endpoint reports them, one row per game.
function games(week: number, ...statuses: string[]): SleeperGame[] {
  return statuses.map((status, i) => ({
    game_id: `${week}-${i}`,
    week,
    status,
    date: "2026-09-13",
    home: "CAR",
    away: "CHI",
  }));
}

const complete = (week: number, n = 16) => games(week, ...Array(n).fill("complete"));

describe("lastCompletedWeek", () => {
  it("reports the last week whose games have all finished", () => {
    // The Tuesday case both earlier versions got wrong: week 2's games are
    // over, and Sleeper's own counters still call week 2 the current week.
    const schedule = [...complete(1), ...complete(2), ...games(3, ...Array(16).fill("pre_game"))];
    expect(lastCompletedWeek(schedule, 1)).toBe(2);
  });

  it("holds a week that still has a game in progress", () => {
    const schedule = [...complete(1), ...games(2, "complete", "in_game")];
    expect(lastCompletedWeek(schedule, 99)).toBe(1);
  });

  it("does not wait on a canceled game", () => {
    // Week 6 of the 2026 season carries one. Treating it as unfinished would
    // stall the recap for the rest of the year.
    const schedule = [...complete(1), ...games(2, "complete", "canceled")];
    expect(lastCompletedWeek(schedule, 0)).toBe(2);
  });

  it("stops at the first unfinished week rather than taking the highest", () => {
    const schedule = [...complete(1), ...games(2, "pre_game"), ...complete(3)];
    expect(lastCompletedWeek(schedule, 0)).toBe(1);
  });

  it("reports nothing complete before the season starts", () => {
    expect(lastCompletedWeek(games(1, ...Array(16).fill("pre_game")), 0)).toBe(0);
  });

  it("falls back when the schedule is unavailable", () => {
    // The endpoint is undocumented, so this is the path that keeps the recap
    // running — a week late — rather than failing outright.
    expect(lastCompletedWeek([], 4)).toBe(4);
  });
});

describe("sleeperLastScoredWeek", () => {
  const state = { week: 3, season: "2026", season_type: "regular" };
  const league = (last_scored_leg?: number) =>
    ({ league_id: "L1", status: "in_season", settings: { last_scored_leg } }) as SleeperLeague;

  it("reads the league's last scored week", () => {
    expect(sleeperLastScoredWeek(league(2), state)).toBe(2);
  });

  it("derives from NFL state when the setting is absent", () => {
    expect(sleeperLastScoredWeek(league(undefined), state)).toBe(2);
  });
});

describe("syncLatestData", () => {
  it("does nothing before any week has completed", async () => {
    const result = await syncLatestData(db, "L1", 2025, 0, []);
    expect(result).toEqual({ weeksFetched: [], inserted: 0, updated: 0, matchups: [] });
    expect(fetchCalls).toHaveLength(0);
  });

  it("fetches every week when the database is empty", async () => {
    const result = await syncLatestData(db, "L1", 2025, 5, []);
    expect(result.weeksFetched).toEqual([1, 2, 3, 4, 5]);
    // Two games per week, bye row ignored.
    expect(result.inserted).toBe(10);
    expect(inserted[0]).toMatchObject({
      year: 2025,
      week: 1,
      is_playoff: false,
      home_user_id: "u1",
      away_user_id: "u2",
      home_score: 100,
      away_score: 90,
    });
  });

  it("skips weeks already stored, but re-checks the two most recent", async () => {
    const stored: Matchup[] = [];
    for (let week = 1; week <= 5; week++) {
      stored.push(existing({ week }));
      stored.push(existing({ week, home_user_id: "u3", away_user_id: "u4", home_score: 80, away_score: 70 }));
    }

    const result = await syncLatestData(db, "L1", 2025, 5, stored);

    expect(result.weeksFetched).toEqual([4, 5]);
    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(0);
  });

  it("updates scores that changed after a stat correction", async () => {
    const stored = [existing({ week: 5, home_score: 1, away_score: 2 })];
    const result = await syncLatestData(db, "L1", 2025, 5, stored);

    expect(result.updated).toBe(1);
    expect(updated[0]).toEqual({ id: "existing-5", home_score: 100, away_score: 90 });
  });

  it("matches an existing row even when Sleeper reverses home and away", async () => {
    // Every week is already stored, so only weeks 4 and 5 get re-checked. The
    // week 5 opener is stored with the teams swapped relative to what Sleeper
    // returns, with the scores swapped to match — the same result.
    const stored: Matchup[] = [];
    for (let week = 1; week <= 5; week++) {
      stored.push(
        week === 5
          ? existing({
              week,
              home_user_id: "u2",
              away_user_id: "u1",
              home_score: 90,
              away_score: 100,
            })
          : existing({ week }),
      );
      stored.push(
        existing({ week, home_user_id: "u3", away_user_id: "u4", home_score: 80, away_score: 70 }),
      );
    }

    const result = await syncLatestData(db, "L1", 2025, 5, stored);

    expect(result.weeksFetched).toEqual([4, 5]);
    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(0);
  });

  it("ignores playoff rows when deciding which weeks have data", async () => {
    const stored = [existing({ week: 3, is_playoff: true, playoff_round: "final" })];
    const result = await syncLatestData(db, "L1", 2025, 4, stored);
    expect(result.weeksFetched).toContain(3);
  });

  // A Worker invocation may only make so many outbound requests, so the sync
  // must not issue work per matchup or re-fetch things per week. These assert
  // the shape of the request pattern rather than a total, which would just
  // need updating every time the logic legitimately changes.
  describe("request pattern", () => {
    it("fetches rosters once no matter how many weeks it syncs", async () => {
      await syncLatestData(db, "L1", 2025, 17, []);
      expect(fetchCalls.filter((c) => c.includes("/rosters"))).toHaveLength(1);
    });

    it("writes once per sync rather than once per matchup", async () => {
      const result = await syncLatestData(db, "L1", 2025, 17, []);

      expect(result.inserted).toBe(34);
      expect(fetchCalls.filter((c) => c === "supabase:insertMatchups")).toHaveLength(1);
    });

    it("reads nothing back after writing", async () => {
      const result = await syncLatestData(db, "L1", 2025, 5, []);

      expect(fetchCalls.filter((c) => c.startsWith("supabase:"))).toEqual([
        "supabase:insertMatchups",
      ]);
      // The caller gets the post-sync state without another read.
      expect(result.matchups).toHaveLength(result.inserted);
    });

    it("only fetches the weeks it actually needs", async () => {
      const stored: Matchup[] = [];
      for (let week = 1; week <= 16; week++) {
        stored.push(existing({ week }));
        stored.push(
          existing({ week, home_user_id: "u3", away_user_id: "u4", home_score: 80, away_score: 70 }),
        );
      }

      await syncLatestData(db, "L1", 2025, 17, stored);

      // 17 weeks are complete: week 17 is new, and week 16 is re-checked for
      // stat corrections. The other 15 are left alone.
      expect(fetchCalls.filter((c) => c.includes("/matchups/"))).toHaveLength(2);
    });
  });
});
