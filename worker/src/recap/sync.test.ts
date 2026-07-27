import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseClient } from "../data/supabase";
import { Matchup, NewMatchup } from "../domain/types";
import { syncLatestData } from "./sync";

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

describe("syncLatestData", () => {
  it("does nothing before any week has completed", async () => {
    const result = await syncLatestData(db, "L1", 2025, 1, []);
    expect(result).toEqual({ weeksFetched: [], inserted: 0, updated: 0, matchups: [] });
    expect(fetchCalls).toHaveLength(0);
  });

  it("fetches every week when the database is empty", async () => {
    const result = await syncLatestData(db, "L1", 2025, 6, []);
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

    const result = await syncLatestData(db, "L1", 2025, 6, stored);

    expect(result.weeksFetched).toEqual([4, 5]);
    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(0);
  });

  it("updates scores that changed after a stat correction", async () => {
    const stored = [existing({ week: 5, home_score: 1, away_score: 2 })];
    const result = await syncLatestData(db, "L1", 2025, 6, stored);

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

    const result = await syncLatestData(db, "L1", 2025, 6, stored);

    expect(result.weeksFetched).toEqual([4, 5]);
    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(0);
  });

  it("ignores playoff rows when deciding which weeks have data", async () => {
    const stored = [existing({ week: 3, is_playoff: true, playoff_round: "final" })];
    const result = await syncLatestData(db, "L1", 2025, 5, stored);
    expect(result.weeksFetched).toContain(3);
  });

  // A Worker invocation may only make so many outbound requests, so the sync
  // must not issue work per matchup or re-fetch things per week. These assert
  // the shape of the request pattern rather than a total, which would just
  // need updating every time the logic legitimately changes.
  describe("request pattern", () => {
    it("fetches rosters once no matter how many weeks it syncs", async () => {
      await syncLatestData(db, "L1", 2025, 18, []);
      expect(fetchCalls.filter((c) => c.includes("/rosters"))).toHaveLength(1);
    });

    it("writes once per sync rather than once per matchup", async () => {
      const result = await syncLatestData(db, "L1", 2025, 18, []);

      expect(result.inserted).toBe(34);
      expect(fetchCalls.filter((c) => c === "supabase:insertMatchups")).toHaveLength(1);
    });

    it("reads nothing back after writing", async () => {
      const result = await syncLatestData(db, "L1", 2025, 6, []);

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

      await syncLatestData(db, "L1", 2025, 18, stored);

      // 17 weeks are complete: week 17 is new, and week 16 is re-checked for
      // stat corrections. The other 15 are left alone.
      expect(fetchCalls.filter((c) => c.includes("/matchups/"))).toHaveLength(2);
    });
  });
});
