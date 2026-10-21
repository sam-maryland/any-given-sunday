import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseClient } from "../data/supabase";
import { SleeperDraft, SleeperTransaction } from "../data/sleeper";
import { DraftPick, Roster, Transaction } from "../domain/types";
import { draftPickRows, syncLeagueActivity, transactionRow } from "./activity";

// A real trade from the 2024 league: roster 2 sends a player and two seconds
// (one its own, one it got from roster 5) to roster 6 for roster 6's first.
const TRADE: SleeperTransaction = {
  transaction_id: "1131784236194729984",
  type: "trade",
  status: "complete",
  leg: 1,
  roster_ids: [2, 6],
  adds: { "10222": 6 },
  drops: { "10222": 2 },
  draft_picks: [
    { round: 2, season: "2025", roster_id: 2, owner_id: 6, previous_owner_id: 2, league_id: null },
    { round: 2, season: "2024", roster_id: 5, owner_id: 6, previous_owner_id: 2, league_id: null },
    { round: 1, season: "2024", roster_id: 6, owner_id: 2, previous_owner_id: 6, league_id: null },
  ],
  waiver_budget: [],
  created: 1724200898744,
  status_updated: 1724201291047,
};

const FAILED_WAIVER: SleeperTransaction = {
  transaction_id: "w1",
  type: "waiver",
  status: "failed",
  leg: 2,
  roster_ids: [3],
  adds: { "4177": 3 },
  drops: null,
  draft_picks: [],
  waiver_budget: [],
  created: 1724300000000,
  status_updated: null,
};

const DRAFT: SleeperDraft = {
  draft_id: "d1",
  status: "complete",
  slot_to_roster_id: { "1": 6, "2": 5 },
};

const PICKS = [
  // Slot 1 is roster 6's pick, made by roster 2 after the trade above.
  {
    pick_no: 1,
    round: 1,
    draft_slot: 1,
    roster_id: 2,
    player_id: "p1",
    metadata: { first_name: "Jeremiyah", last_name: "Love", position: "RB" },
  },
  { pick_no: 2, round: 1, draft_slot: 2, roster_id: 5, player_id: "p2", metadata: null },
];

describe("transactionRow", () => {
  it("keeps the trade's players, picks and timing", () => {
    expect(transactionRow(TRADE, "L", 2024)).toEqual({
      id: "1131784236194729984",
      league_id: "L",
      year: 2024,
      week: 1,
      type: "trade",
      status: "complete",
      roster_ids: [2, 6],
      adds: { "10222": 6 },
      drops: { "10222": 2 },
      draft_picks: [
        { season: "2025", round: 2, roster_id: 2, previous_owner_id: 2, owner_id: 6 },
        { season: "2024", round: 2, roster_id: 5, previous_owner_id: 2, owner_id: 6 },
        { season: "2024", round: 1, roster_id: 6, previous_owner_id: 6, owner_id: 2 },
      ],
      waiver_budget: [],
      created_at: "2024-08-21T00:41:38.744Z",
      completed_at: "2024-08-21T00:48:11.047Z",
    });
  });

  it("handles a claim that was never processed", () => {
    const row = transactionRow(FAILED_WAIVER, "L", 2024);
    expect(row.status).toBe("failed");
    expect(row.completed_at).toBeNull();
    expect(row.drops).toBeNull();
  });
});

describe("draftPickRows", () => {
  it("names a traded pick after the roster it was issued to", () => {
    const [traded, own] = draftPickRows(DRAFT, PICKS, "L", 2024);
    expect(traded).toMatchObject({ original_roster_id: 6, roster_id: 2, player_name: "Jeremiyah Love", position: "RB" });
    expect(own).toMatchObject({ original_roster_id: 5, roster_id: 5, player_name: "", position: "" });
  });
});

describe("syncLeagueActivity", () => {
  let fetchCalls: string[];
  let stored: { rosters: Roster[]; transactions: Transaction[]; picks: DraftPick[] };
  let latestWeek: number | null;
  let hasPicks: boolean;
  let draftStatus: string;
  let db: SupabaseClient;

  beforeEach(() => {
    fetchCalls = [];
    stored = { rosters: [], transactions: [], picks: [] };
    latestWeek = null;
    hasPicks = false;
    draftStatus = "complete";

    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);
      if (url.endsWith("/rosters")) {
        return new Response(
          JSON.stringify([
            { roster_id: 2, owner_id: "u2" },
            { roster_id: 6, owner_id: "u6" },
            { roster_id: 7, owner_id: null },
          ]),
        );
      }
      const week = url.match(/\/transactions\/(\d+)$/)?.[1];
      if (week) {
        return new Response(JSON.stringify(week === "1" ? [TRADE] : week === "2" ? [FAILED_WAIVER] : []));
      }
      if (url.endsWith("/draft/d1")) {
        return new Response(JSON.stringify({ ...DRAFT, status: draftStatus }));
      }
      if (url.endsWith("/draft/d1/picks")) {
        return new Response(JSON.stringify(PICKS));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    db = {
      upsertRosters: async (rows: Roster[]) => void stored.rosters.push(...rows),
      upsertTransactions: async (rows: Transaction[]) => void stored.transactions.push(...rows),
      upsertDraftPicks: async (rows: DraftPick[]) => void stored.picks.push(...rows),
      getLatestTransactionWeek: async () => latestWeek,
      hasDraftPicks: async () => hasPicks,
    } as unknown as SupabaseClient;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const weeksFetched = () =>
    fetchCalls.flatMap((u) => u.match(/\/transactions\/(\d+)$/)?.[1] ?? []).map(Number);

  it("backfills every week on the first run and stores the draft", async () => {
    const result = await syncLeagueActivity(db, "L", 2024, "d1", 3);

    expect(weeksFetched()).toEqual([1, 2, 3]);
    expect(result).toEqual({ weeksFetched: [1, 2, 3], transactions: 2, trades: 1, draftPicks: 2 });
    expect(stored.rosters).toEqual([
      { league_id: "L", roster_id: 2, user_id: "u2" },
      { league_id: "L", roster_id: 6, user_id: "u6" },
    ]);
    expect(stored.picks).toHaveLength(2);
  });

  it("re-reads the latest stored week and skips the settled ones", async () => {
    latestWeek = 5;
    hasPicks = true;
    const result = await syncLeagueActivity(db, "L", 2026, "d1", 7);

    expect(weeksFetched()).toEqual([5, 6, 7]);
    expect(result.draftPicks).toBe(0);
    expect(fetchCalls.some((u) => u.includes("/draft/"))).toBe(false);
  });

  it("stops at the last week Sleeper files transactions under", async () => {
    latestWeek = 17;
    await syncLeagueActivity(db, "L", 2026, null, 22);
    expect(weeksFetched()).toEqual([17, 18]);
  });

  it("waits for the draft to finish before storing it", async () => {
    draftStatus = "drafting";
    const result = await syncLeagueActivity(db, "L", 2026, "d1", 1);
    expect(result.draftPicks).toBe(0);
    expect(stored.picks).toHaveLength(0);
    expect(fetchCalls.some((u) => u.endsWith("/picks"))).toBe(false);
  });
});
