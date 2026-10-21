import { describe, expect, it } from "vitest";
import { buildTradeStats } from "./trades";
import { Roster, TradedPick, Transaction } from "./types";

// Two seasons, and the same roster ids mean different owners in each: in
// 2025 roster 1 is a and roster 2 is b; in 2026 b took over roster 1 and a
// moved to roster 3.
const rosters: Roster[] = [
  { league_id: "L2025", roster_id: 1, user_id: "a" },
  { league_id: "L2025", roster_id: 2, user_id: "b" },
  { league_id: "L2025", roster_id: 3, user_id: "c" },
  { league_id: "L2026", roster_id: 1, user_id: "b" },
  { league_id: "L2026", roster_id: 3, user_id: "a" },
  { league_id: "L2026", roster_id: 2, user_id: "c" },
];

let n = 0;
function tx(year: number, type: string, status: string, rosterIds: number[], extra: Partial<Transaction> = {}): Transaction {
  return {
    id: `t${++n}`,
    league_id: `L${year}`,
    year,
    week: 1,
    type,
    status,
    roster_ids: rosterIds,
    adds: null,
    drops: null,
    draft_picks: [],
    waiver_budget: [],
    created_at: "2025-09-01T00:00:00Z",
    completed_at: null,
    ...extra,
  };
}

const pick = (from: number, to: number): TradedPick => ({ season: "2027", round: 1, roster_id: from, previous_owner_id: from, owner_id: to });

const transactions = [
  // a sends b a pick and a player for two players.
  tx(2025, "trade", "complete", [1, 2], { draft_picks: [pick(1, 2)], adds: { p1: 2, p2: 1, p3: 1 }, drops: { p1: 1, p2: 2, p3: 2 } }),
  // a and c, twice.
  tx(2025, "trade", "complete", [1, 3], { draft_picks: [pick(3, 1), pick(3, 1)] }),
  // 2026: roster 3 is now a, roster 1 is b.
  tx(2026, "trade", "complete", [3, 2]),
  tx(2026, "trade", "complete", [1, 3], { draft_picks: [pick(1, 3)] }),
  // A trade that never went through counts for nothing.
  tx(2026, "trade", "failed", [1, 3], { draft_picks: [pick(1, 3)] }),
  tx(2025, "waiver", "complete", [1], { adds: { p9: 1 } }),
  tx(2025, "waiver", "failed", [1], { adds: { p8: 1 } }),
  tx(2025, "waiver", "failed", [2], { adds: { p8: 2 } }),
  tx(2026, "free_agent", "complete", [3], { adds: { p7: 3 }, drops: { p6: 3 } }),
  // A drop with no add is not a pickup.
  tx(2026, "free_agent", "complete", [3], { drops: { p7: 3 } }),
  tx(2026, "commissioner", "complete", [3], { adds: { p5: 3 } }),
  // A roster with no owner on record is skipped.
  tx(2026, "free_agent", "complete", [9], { adds: { p4: 9 } }),
];

const stats = buildTradeStats(transactions, rosters);
const of = (id: string) => stats.get(id)!;

describe("buildTradeStats", () => {
  it("counts completed trades, resolving rosters in each trade's own league", () => {
    expect(of("a").trades).toBe(4);
    expect(of("b").trades).toBe(2);
    expect(of("c").trades).toBe(2);
    expect([...stats.values()].reduce((sum, s) => sum + s.trades, 0)).toBe(8); // 4 trades, two sides each
  });

  it("follows picks from the roster that gave them up to the one that got them", () => {
    expect(of("a")).toMatchObject({ picksSent: 1, picksReceived: 3 });
    expect(of("b")).toMatchObject({ picksSent: 1, picksReceived: 1 });
    expect(of("c")).toMatchObject({ picksSent: 2, picksReceived: 0 });
  });

  it("counts players each way in a trade", () => {
    expect(of("a")).toMatchObject({ playersSent: 1, playersReceived: 2 });
    expect(of("b")).toMatchObject({ playersSent: 2, playersReceived: 1 });
  });

  it("ranks trade partners by trades made", () => {
    expect(of("a").partners).toEqual([
      { userId: "b", trades: 2 },
      { userId: "c", trades: 2 },
    ]);
    expect(of("c").partners).toEqual([{ userId: "a", trades: 2 }]);
  });

  it("counts waiver and free agent pickups, and failed claims", () => {
    expect(of("a")).toMatchObject({ waiverAdds: 1, failedClaims: 1, freeAgentAdds: 1 });
    expect(of("b")).toMatchObject({ waiverAdds: 0, failedClaims: 1, freeAgentAdds: 0 });
  });

  it("leaves out owners it cannot resolve", () => {
    expect([...stats.keys()].sort()).toEqual(["a", "b", "c"]);
  });
});
