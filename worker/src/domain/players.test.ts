import { describe, expect, it } from "vitest";
import { playerIdsInLeague, playerRows } from "./players";
import { DraftPick, Transaction } from "./types";

const tx = (adds: Record<string, number> | null, drops: Record<string, number> | null): Transaction => ({
  id: "t",
  league_id: "L",
  year: 2025,
  week: 1,
  type: "free_agent",
  status: "complete",
  roster_ids: [1],
  adds,
  drops,
  draft_picks: [],
  waiver_budget: [],
  created_at: "2025-09-01T00:00:00Z",
  completed_at: null,
});

const pick = (player_id: string): DraftPick => ({
  draft_id: "D",
  league_id: "L",
  year: 2025,
  pick_no: 1,
  round: 1,
  draft_slot: 1,
  original_roster_id: 1,
  roster_id: 1,
  player_id,
  player_name: "Old Name",
  position: "RB",
});

describe("playerIdsInLeague", () => {
  it("collects players added, dropped and drafted, once each", () => {
    const ids = playerIdsInLeague([tx({ "1": 1 }, { "2": 1 }), tx(null, { "1": 1 })], [pick("3"), pick("2")]);
    expect([...ids].sort()).toEqual(["1", "2", "3"]);
  });
});

describe("playerRows", () => {
  it("names players as Sleeper does today, with defenses built from their parts", () => {
    const { rows, missing } = playerRows(["4046", "KC"], {
      "4046": { full_name: "Patrick Mahomes", position: "QB", team: "KC" },
      KC: { first_name: "Kansas City", last_name: "Chiefs", position: "DEF", team: "KC" },
    });
    expect(rows).toEqual([
      { id: "4046", name: "Patrick Mahomes", position: "QB", team: "KC" },
      { id: "KC", name: "Kansas City Chiefs", position: "DEF", team: "KC" },
    ]);
    expect(missing).toEqual([]);
  });

  it("keeps retired and unsigned players, with no team", () => {
    const { rows } = playerRows(["96"], { "96": { full_name: "Aaron Rodgers", position: "QB", team: null } });
    expect(rows).toEqual([{ id: "96", name: "Aaron Rodgers", position: "QB", team: null }]);
  });

  it("reports ids Sleeper does not have, or has no name for", () => {
    const { rows, missing } = playerRows(["1", "2"], { "2": { position: "WR" } });
    expect(rows).toEqual([]);
    expect(missing).toEqual(["1", "2"]);
  });
});
