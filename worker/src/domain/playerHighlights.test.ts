import { describe, expect, it } from "vitest";
import { buildPlayerHighlights } from "./playerHighlights";
import { DraftPick, Player, Roster, Transaction } from "./types";

// Three teams, owners a, b and c on rosters 1, 2 and 3 in both seasons.
const rosters: Roster[] = ["L2023", "L2024"].flatMap((league_id) =>
  ["a", "b", "c"].map((user_id, i) => ({ league_id, roster_id: i + 1, user_id })),
);

const players = new Map<string, Player>(
  [
    ["1", "Startup Star"],
    ["2", "Startup Swapped"],
    ["3", "Startup Steady"],
    ["10", "Rookie Traveler"],
    ["20", "Wire Guy"],
    ["21", "Bench Body"],
  ].map(([id, name]) => [id!, { id: id!, name: name!, position: "WR", team: null }]),
);

const pick = (p: Partial<DraftPick> & Pick<DraftPick, "player_id" | "pick_no">): DraftPick => ({
  draft_id: "D2023",
  league_id: "L2023",
  year: 2023,
  round: 1,
  draft_slot: p.pick_no,
  original_roster_id: p.pick_no,
  roster_id: p.pick_no,
  player_name: players.get(p.player_id)?.name ?? "",
  position: "WR",
  ...p,
});

const draftPicks: DraftPick[] = [
  pick({ player_id: "1", pick_no: 1 }),
  pick({ player_id: "2", pick_no: 2 }),
  pick({ player_id: "3", pick_no: 3 }),
  // The 2024 1st issued to c (roster 3), made by a after two trades.
  pick({ draft_id: "D2024", league_id: "L2024", year: 2024, player_id: "10", pick_no: 1, draft_slot: 1, original_roster_id: 3, roster_id: 1 }),
];

let n = 0;
const tx = (t: Partial<Transaction> & Pick<Transaction, "type" | "completed_at">): Transaction => ({
  id: `t${++n}`,
  league_id: "L2023",
  year: 2023,
  week: 1,
  status: "complete",
  roster_ids: [1],
  adds: null,
  drops: null,
  draft_picks: [],
  waiver_budget: [],
  created_at: t.completed_at!,
  ...t,
});

const transactions: Transaction[] = [
  // b sends Startup Swapped to c for c's 2024 1st, then passes the pick to a.
  tx({
    type: "trade",
    completed_at: "2023-10-01T00:00:00Z",
    roster_ids: [2, 3],
    adds: { "2": 3 },
    drops: { "2": 2 },
    draft_picks: [{ season: "2024", round: 1, roster_id: 3, previous_owner_id: 3, owner_id: 2 }],
  }),
  tx({
    type: "trade",
    completed_at: "2023-11-01T00:00:00Z",
    roster_ids: [1, 2],
    draft_picks: [{ season: "2024", round: 1, roster_id: 3, previous_owner_id: 2, owner_id: 1 }],
  }),
  // Wire Guy bounces between all three teams.
  tx({ type: "waiver", completed_at: "2023-09-10T00:00:00Z", roster_ids: [1], adds: { "20": 1 } }),
  tx({ type: "free_agent", completed_at: "2023-09-20T00:00:00Z", roster_ids: [1], drops: { "20": 1 } }),
  tx({ type: "free_agent", completed_at: "2023-12-01T00:00:00Z", roster_ids: [2], adds: { "20": 2 }, drops: { "21": 2 } }),
  tx({ type: "waiver", completed_at: "2024-09-15T00:00:00Z", league_id: "L2024", year: 2024, roster_ids: [3], adds: { "20": 3 } }),
  // A claim that lost out moves nobody.
  tx({ type: "waiver", status: "failed", completed_at: "2024-09-16T00:00:00Z", league_id: "L2024", year: 2024, roster_ids: [1], adds: { "1": 1 } }),
];

const build = (overrides = {}) =>
  buildPlayerHighlights({ transactions, draftPicks, rosters, players, startupYear: 2023, ...overrides });

describe("buildPlayerHighlights", () => {
  it("lists the latest trades and pickups, newest first, skipping bare drops and failed claims", () => {
    const { recent } = build();
    expect(recent.map((m) => m.at)).toEqual([
      "2024-09-15T00:00:00Z",
      "2023-12-01T00:00:00Z",
      "2023-11-01T00:00:00Z",
      "2023-10-01T00:00:00Z",
      "2023-09-10T00:00:00Z",
    ]);
    expect(recent[1]).toMatchObject({
      kind: "pickup",
      via: "free_agent",
      ownerId: "b",
      added: [{ kind: "player", id: "20", name: "Wire Guy" }],
      dropped: [{ kind: "player", id: "21", name: "Bench Body" }],
    });
  });

  it("says what each side of a trade got, naming a pick's player once it is made", () => {
    const trade = build().recent.find((m) => m.at === "2023-10-01T00:00:00Z");
    expect(trade).toEqual({
      kind: "trade",
      id: expect.any(String),
      at: "2023-10-01T00:00:00Z",
      sides: [
        {
          ownerId: "b",
          gets: [{ kind: "pick", season: "2024", round: 1, originalOwnerId: "c", became: { id: "10", name: "Rookie Traveler" } }],
        },
        { ownerId: "c", gets: [{ kind: "player", id: "2", name: "Startup Swapped", position: "WR" }] },
      ],
    });
  });

  it("gives a side to a roster that receives something, even one Sleeper left out", () => {
    const odd = tx({
      type: "trade",
      completed_at: "2025-01-01T00:00:00Z",
      roster_ids: [2],
      draft_picks: [{ season: "2026", round: 2, roster_id: 2, previous_owner_id: 2, owner_id: 3 }],
    });
    const [latest] = build({ transactions: [...transactions, odd] }).recent;
    expect(latest).toMatchObject({ sides: [{ ownerId: "b", gets: [] }, { ownerId: "c", gets: [{ kind: "pick", season: "2026", became: null }] }] });
  });

  it("caps the recent moves", () => {
    expect(build({ recentLimit: 2 }).recent).toHaveLength(2);
  });

  it("follows a pick from the owner it was issued to through the one who used it", () => {
    expect(build().pickTrails).toEqual([
      {
        player: { id: "10", name: "Rookie Traveler", position: "WR" },
        year: 2024,
        startup: false,
        round: 1,
        pickInRound: 1,
        ownerIds: ["c", "b", "a"],
      },
    ]);
  });

  it("leaves out picks traded only once", () => {
    const once = transactions.filter((t) => t.completed_at !== "2023-11-01T00:00:00Z");
    expect(build({ transactions: once }).pickTrails).toEqual([]);
  });

  it("counts startup picks never moved, ignoring failed claims", () => {
    const { lifers } = build();
    expect(lifers).toMatchObject({ year: 2023, count: 2, of: 3 });
    expect(lifers.players.map((l) => [l.player.name, l.ownerId, l.pickInRound])).toEqual([
      ["Startup Star", "a", 1],
      ["Startup Steady", "c", 3],
    ]);
    // a and c have one each: nobody leads.
    expect(lifers.leader).toBeNull();
  });

  it("names a lifer leader only when one owner has the most", () => {
    const extra = pick({ player_id: "4", pick_no: 4, draft_slot: 1, original_roster_id: 1, roster_id: 1, round: 2 });
    expect(build({ draftPicks: [...draftPicks, extra] }).lifers.leader).toEqual({ ownerId: "a", count: 2 });
  });

  it("ranks journeymen by how many owners they have had", () => {
    expect(build().journeymen).toEqual([
      { player: { id: "20", name: "Wire Guy", position: "WR" }, owners: 3, trades: 0, pickups: 3 },
    ]);
  });

  it("collects every owner the lists mention", () => {
    expect(build().ownerIds).toEqual(["a", "b", "c"]);
  });
});
