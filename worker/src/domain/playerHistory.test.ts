import { describe, expect, it } from "vitest";
import { buildPlayerHistory, lookupsFor } from "./playerHistory";
import { DraftPick, Player, Roster, TradedPick, Transaction } from "./types";

// Modeled on Xavier Legette's real path. Three seasons, four owners, and the
// same roster ids throughout: roster 5 is a, 11 is b, 2 is c, 6 is d.
const owners: Record<number, string> = { 5: "a", 11: "b", 2: "c", 6: "d" };
const rosters: Roster[] = ["L2023", "L2024", "L2025"].flatMap((league_id) =>
  [...Object.entries(owners), ["1", "e"], ["3", "f"], ["4", "g"], ["7", "h"], ["8", "i"], ["9", "j"], ["10", "k"], ["12", "l"]].map(
    ([roster_id, user_id]) => ({ league_id, roster_id: Number(roster_id), user_id: user_id! }),
  ),
);

let n = 0;
function tx(year: number, at: string, type: string, extra: Partial<Transaction>): Transaction {
  return {
    id: `t${++n}`,
    league_id: `L${year}`,
    year,
    week: 1,
    type,
    status: "complete",
    roster_ids: [],
    adds: null,
    drops: null,
    draft_picks: [],
    waiver_budget: [],
    created_at: at,
    completed_at: at,
    ...extra,
  };
}
const pick = (season: number, round: number, issuedTo: number, from: number, to: number): TradedPick => ({
  season: String(season),
  round,
  roster_id: issuedTo,
  previous_owner_id: from,
  owner_id: to,
});

const LEGETTE = "100";
const transactions: Transaction[] = [
  // Listed out of order: the history sorts by when each move went through.
  tx(2025, "2025-11-01T18:33:40Z", "trade", {
    roster_ids: [6, 11],
    adds: { [LEGETTE]: 11, "201": 11, "202": 6 },
    drops: { [LEGETTE]: 6, "201": 6, "202": 11 },
    draft_picks: [pick(2026, 2, 11, 11, 6)],
  }),
  // a's 2024 2nd goes to b, with a 3rd, for b's 1st.
  tx(2023, "2023-10-08T02:19:41Z", "trade", {
    roster_ids: [5, 11],
    draft_picks: [pick(2024, 2, 5, 5, 11), pick(2024, 3, 5, 5, 11), pick(2024, 1, 11, 11, 5)],
  }),
  tx(2023, "2023-11-01T11:36:52Z", "trade", { roster_ids: [2, 11], adds: { "203": 11 }, drops: { "203": 2 }, draft_picks: [pick(2024, 2, 5, 11, 2)] }),
  tx(2024, "2024-08-21T00:48:11Z", "trade", { roster_ids: [2, 6], draft_picks: [pick(2024, 2, 5, 2, 6)] }),
  tx(2025, "2025-12-01T00:00:00Z", "free_agent", { roster_ids: [11], drops: { [LEGETTE]: 11 } }),
  // A failed claim never happened.
  tx(2025, "2025-12-02T00:00:00Z", "waiver", { status: "failed", roster_ids: [2], adds: { [LEGETTE]: 2 } }),
  tx(2025, "2025-12-03T00:00:00Z", "waiver", { roster_ids: [8], adds: { [LEGETTE]: 8 }, drops: { "204": 8 } }),
];

const draftPick = (player_id: string, year: number, round: number, pick_no: number, original: number, by: number, name = "X"): DraftPick => ({
  draft_id: `D${year}`,
  league_id: `L${year}`,
  year,
  pick_no,
  round,
  draft_slot: 0,
  original_roster_id: original,
  roster_id: by,
  player_id,
  player_name: name,
  position: "WR",
});

const players = new Map<string, Player>(
  [
    [LEGETTE, "Xavier Legette"],
    ["201", "Calvin Ridley"],
    ["202", "Terry McLaurin"],
    ["203", "Travis Kelce"],
    ["204", "Darius Slayton"],
    ["300", "Jayden Daniels"],
  ].map(([id, name]): [string, Player] => [id!, { id: id!, name: name!, position: "WR", team: null }]),
);

const history = buildPlayerHistory({
  playerId: LEGETTE,
  draftPicks: [draftPick(LEGETTE, 2024, 2, 14, 5, 6)],
  transactions,
  rosters,
  startupYear: 2023,
  players,
  // b's 2024 1st, moved in the first trade, became Jayden Daniels.
  pickResults: [draftPick("300", 2024, 1, 2, 11, 5, "Jayden Daniels (at the draft)")],
});

describe("buildPlayerHistory", () => {
  it("leads with the draft, then every move in the order it went through", () => {
    expect(history.events.map((e) => e.kind)).toEqual(["drafted", "traded", "dropped", "added"]);
  });

  it("places the pick within its round and tells a rookie draft from the startup", () => {
    expect(history.events[0]).toMatchObject({ kind: "drafted", year: 2024, startup: false, round: 2, pickInRound: 2, byId: "d", originalOwnerId: "a" });
  });

  it("follows the pick he was drafted with through every owner", () => {
    const drafted = history.events[0]!;
    if (drafted.kind !== "drafted") throw new Error("not a draft");
    expect(drafted.pickTrades.map((l) => [l.fromId, l.toId])).toEqual([
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
    ]);
    expect(drafted.pickTrades[0]).toMatchObject({
      sentWith: [{ kind: "pick", season: "2024", round: 3, originalOwnerId: "a", became: null }],
      receivedFor: [{ kind: "pick", season: "2024", round: 1, originalOwnerId: "b", became: { id: "300", name: "Jayden Daniels" } }],
    });
    // A player that moved the other way is what the sender got back.
    expect(drafted.pickTrades[1]!.receivedFor).toEqual([{ kind: "player", id: "203", name: "Travis Kelce", position: "WR" }]);
  });

  it("tells a trade from the side he left, with what went along and what came back", () => {
    expect(history.events[1]).toMatchObject({
      kind: "traded",
      fromId: "d",
      toId: "b",
      sentWith: [{ kind: "player", id: "201", name: "Calvin Ridley" }],
      receivedFor: [
        { kind: "player", id: "202", name: "Terry McLaurin" },
        { kind: "pick", season: "2026", round: 2, originalOwnerId: "b" },
      ],
    });
  });

  it("names who he was dropped for or picked up in place of", () => {
    expect(history.events[2]).toMatchObject({ kind: "dropped", via: "free_agent", byId: "b", alongside: [] });
    expect(history.events[3]).toMatchObject({ kind: "added", via: "waiver", byId: "i", alongside: [{ id: "204", name: "Darius Slayton" }] });
  });

  it("knows who holds him now, and every owner the page has to name", () => {
    expect(history.currentOwnerId).toBe("i");
    expect(history.ownerIds).toEqual(["a", "b", "c", "d", "i"]);
  });

  it("calls a dropped player a free agent", () => {
    const dropped = buildPlayerHistory({
      playerId: LEGETTE,
      draftPicks: [],
      transactions: transactions.slice(0, 5),
      rosters,
      startupYear: 2023,
      players,
      pickResults: [],
    });
    expect(dropped.currentOwnerId).toBeNull();
    expect(dropped.events.map((e) => e.kind)).toEqual(["traded", "dropped"]);
  });

  it("puts a later season's draft after the moves of earlier seasons", () => {
    // Picked up and dropped in 2023, then drafted in a 2025 redraft.
    const redrafted = buildPlayerHistory({
      playerId: "500",
      draftPicks: [draftPick("500", 2025, 3, 30, 6, 6)],
      transactions: [
        tx(2023, "2023-10-01T00:00:00Z", "free_agent", { roster_ids: [5], adds: { "500": 5 } }),
        tx(2023, "2023-11-01T00:00:00Z", "free_agent", { roster_ids: [5], drops: { "500": 5 } }),
        tx(2025, "2025-10-01T00:00:00Z", "waiver", { roster_ids: [6], drops: { "500": 6 } }),
      ],
      rosters,
      startupYear: 2023,
      players,
      pickResults: [],
    });
    expect(redrafted.events.map((e) => [e.kind, e.year])).toEqual([
      ["added", 2023],
      ["dropped", 2023],
      ["drafted", 2025],
      ["dropped", 2025],
    ]);
    expect(redrafted.currentOwnerId).toBeNull();
  });

  it("keeps a startup pick who never moved with the owner who drafted him", () => {
    const startup = buildPlayerHistory({
      playerId: "400",
      draftPicks: [draftPick("400", 2023, 1, 8, 6, 6)],
      transactions: [],
      rosters,
      startupYear: 2023,
      players,
      pickResults: [],
    });
    expect(startup.events).toEqual([
      expect.objectContaining({ kind: "drafted", startup: true, round: 1, pickInRound: 8, byId: "d", pickTrades: [] }),
    ]);
    expect(startup.currentOwnerId).toBe("d");
  });
});

describe("lookupsFor", () => {
  it("lists every player and pick slot the transactions mention, once each", () => {
    const { playerIds, pickSlots } = lookupsFor(transactions);
    expect(playerIds).toEqual([LEGETTE, "201", "202", "203", "204"]);
    expect(pickSlots).toContainEqual({ year: 2024, round: 2, originalRosterId: 5 });
    expect(pickSlots).toHaveLength(4);
  });
});
