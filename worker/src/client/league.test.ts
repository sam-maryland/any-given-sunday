import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayoffRound } from "../domain/types";
import { leagueStatus, loadLeague, parseLeagueId } from "./league";
import { historyFor, playoffRaceFor, standingsFor, transactionsForPlayer } from "./site";

// A four-team redraft league with two seasons on Sleeper: 2025, finished,
// and 2026, three weeks into a four-week regular season. Two-team playoffs
// (a final only) start in week 5. In 2026 roster 4 has no owner.
const settings = (season: string) => ({
  type: 0,
  playoff_teams: 2,
  playoff_week_start: 5,
  playoff_round_type: 0,
  last_scored_leg: season === "2026" ? 3 : 5,
});
const LEAGUES: Record<string, object> = {
  L26: { league_id: "L26", name: "Test League", season: "2026", status: "in_season", previous_league_id: "L25", draft_id: "D26", settings: settings("2026") },
  L25: { league_id: "L25", name: "Test League", season: "2025", status: "complete", previous_league_id: null, draft_id: "D25", settings: settings("2025") },
};
const users = [1, 2, 3, 4].map((i) => ({ user_id: `u${i}`, display_name: `user${i}`, metadata: { team_name: `Team ${i}` } }));

// Every week rosters 1 and 2 meet, as do 3 and 4; the lower roster wins by 10.
const week = () => [
  { matchup_id: 1, roster_id: 1, points: 110 },
  { matchup_id: 1, roster_id: 2, points: 100 },
  { matchup_id: 2, roster_id: 3, points: 90 },
  { matchup_id: 2, roster_id: 4, points: 80 },
];

function respond(path: string): unknown {
  let m: RegExpMatchArray | null;
  if ((m = path.match(/^\/v1\/league\/(\w+)$/))) return LEAGUES[m[1]!] ?? null;
  if ((m = path.match(/^\/v1\/league\/(\w+)\/users$/))) return m[1] === "L26" ? users.slice(0, 3) : users;
  if ((m = path.match(/^\/v1\/league\/(\w+)\/rosters$/))) {
    return [1, 2, 3, 4].map((r) => ({ roster_id: r, owner_id: m![1] === "L26" && r === 4 ? null : `u${r}` }));
  }
  if (path.match(/\/matchups\/\d+$/)) return week();
  if (path.endsWith("/winners_bracket")) return [{ r: 1, m: 1, p: 1, t1: 1, t2: 3, w: 3, l: 1 }];
  if ((m = path.match(/^\/v1\/league\/(\w+)\/transactions\/(\d+)$/))) {
    return m[1] === "L25" && m[2] === "2"
      ? [{ transaction_id: "t1", type: "free_agent", status: "complete", leg: 2, roster_ids: [2], adds: { p9: 2 }, drops: null, draft_picks: null, waiver_budget: null, created: 0, status_updated: 0 }]
      : [];
  }
  if ((m = path.match(/^\/v1\/draft\/(\w+)$/))) return { draft_id: m[1], status: "complete", slot_to_roster_id: { 1: 1, 2: 2, 3: 3, 4: 4 } };
  if (path.endsWith("/picks")) {
    return [{ pick_no: 1, round: 1, draft_slot: 1, roster_id: 1, player_id: "p1", is_keeper: true, metadata: { first_name: "Pat", last_name: "One", position: "RB" } }];
  }
  if (path === "/v1/state/nfl") return { week: 4, season: "2026", season_type: "regular" };
  if (path.startsWith("/schedule/")) throw new Error("unavailable");
  throw new Error(`unexpected ${path}`);
}

let requests: string[];
beforeEach(() => {
  requests = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = String(input).replace("https://api.sleeper.app", "");
    requests.push(path);
    try {
      return new Response(JSON.stringify(respond(path)));
    } catch {
      return new Response("nope", { status: 404 });
    }
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("parseLeagueId", () => {
  it("accepts a bare id or a Sleeper league link", () => {
    expect(parseLeagueId(" 1339291414533525504 ")).toBe("1339291414533525504");
    expect(parseLeagueId("https://sleeper.com/leagues/1339291414533525504/matchup")).toBe("1339291414533525504");
    expect(parseLeagueId("not a league")).toBeNull();
  });
});

describe("leagueStatus", () => {
  it("maps Sleeper's statuses to the site's", () => {
    expect(leagueStatus("pre_draft")).toBe("PENDING");
    expect(leagueStatus("drafting")).toBe("PENDING");
    expect(leagueStatus("in_season")).toBe("IN_PROGRESS");
    expect(leagueStatus("complete")).toBe("COMPLETE");
  });
});

describe("loadLeague", () => {
  it("walks back through every season and reads each into the site's rows", async () => {
    const data = await loadLeague("L26");
    expect(data.name).toBe("Test League");
    expect(data.seasons.map((s) => [s.league.year, s.league.status])).toEqual([
      [2026, "IN_PROGRESS"],
      [2025, "COMPLETE"],
    ]);

    const [live, done] = data.seasons as [(typeof data.seasons)[0], (typeof data.seasons)[0]];
    // Weeks 1-3 are played; week 4's pairings are still to come.
    expect(live.matchups.map((m) => m.week)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(live.remaining).toEqual([
      { week: 4, homeId: "u1", awayId: "u2" },
      { week: 4, homeId: "u3", awayId: "orphan-2026-4" },
    ]);
    expect(live.owners.find((o) => o.id === "orphan-2026-4")?.label).toBe("Team 4 (no owner)");
    expect(live.league.format?.type).toBe("redraft");

    // The finished season has its final and its podium.
    const final = done.matchups.filter((m) => m.is_playoff);
    expect(final).toMatchObject([{ playoff_round: PlayoffRound.Finals, week: 5, home_user_id: "u1", away_user_id: "u3" }]);
    expect([done.league.first_place, done.league.second_place]).toEqual(["u3", "u1"]);
    expect(done.transactions.map((t) => t.id)).toEqual(["t1"]);
    expect(done.draftPicks[0]).toMatchObject({ player_id: "p1", player_name: "Pat One", is_keeper: true });
  });

  it("builds each page's data from the loaded league", async () => {
    const data = await loadLeague("L26");

    const live = standingsFor(data)!;
    expect(live.year).toBe(2026);
    expect(live.playoffCutoff).toBe(2);
    expect(live.tiebreaker).toBe("pointsFor");
    expect(live.standings.map((s) => s.name)).toEqual(["Team 1", "Team 3", "Team 2", "Team 4 (no owner)"]);

    const last = standingsFor(data, 2025)!;
    expect(last.standings.slice(0, 2).map((s) => [s.name, s.finish])).toEqual([
      ["Team 3", "champion"],
      ["Team 1", "runnerUp"],
    ]);

    const race = playoffRaceFor(data);
    expect(race).toMatchObject({ active: true, throughWeek: 3, lastRegularWeek: 4, playoffTeams: 2, useHeadToHead: false });

    const history = historyFor(data);
    expect(history.podiums).toEqual([{ year: 2025, first: "u3", second: "u1", third: "" }]);
    expect(history.payouts).toBeNull();
    // u4 left after 2025, and keeps the team name they had then.
    expect(history.owners.find((o) => o.userId === "u4")?.label).toBe("Team 4");
  });
});

describe("transactionsForPlayer", () => {
  it("finds moves of the player and trades of the pick he was drafted with", () => {
    const base = { league_id: "L", year: 2025, week: 1, status: "complete", roster_ids: [], waiver_budget: [], created_at: "", completed_at: null };
    const moved = { ...base, id: "a", type: "waiver", adds: { p1: 1 }, drops: null, draft_picks: [] };
    const pickTrade = {
      ...base,
      id: "b",
      type: "trade",
      adds: null,
      drops: null,
      draft_picks: [{ season: "2026", round: 1, roster_id: 3, previous_owner_id: 3, owner_id: 2 }],
    };
    const other = { ...base, id: "c", type: "free_agent", adds: { p2: 1 }, drops: null, draft_picks: [] };
    const pick = {
      draft_id: "D",
      league_id: "L",
      year: 2026,
      pick_no: 3,
      round: 1,
      draft_slot: 3,
      original_roster_id: 3,
      roster_id: 2,
      player_id: "p1",
      player_name: "Pat One",
      position: "RB",
    };
    expect(transactionsForPlayer([moved, pickTrade, other], [pick], "p1").map((t) => t.id)).toEqual(["a", "b"]);
  });
});
