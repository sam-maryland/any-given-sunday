import { describe, expect, it } from "vitest";
import { matchupsToStandingsMap, sortStandingsMap, standingsForLeague } from "./standings";
import { League, LeagueStatus, Matchup, PlayoffRound } from "./types";

let nextId = 0;

function matchup(overrides: Partial<Matchup> & Pick<Matchup, "home_user_id" | "away_user_id">): Matchup {
  return {
    id: `m${nextId++}`,
    year: 2025,
    week: 1,
    is_playoff: false,
    playoff_round: null,
    home_seed: null,
    away_seed: null,
    home_score: 100,
    away_score: 90,
    ...overrides,
  };
}

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

describe("matchupsToStandingsMap", () => {
  it("accumulates records, points, and head-to-head wins", () => {
    const standings = matchupsToStandingsMap([
      matchup({ home_user_id: "a", away_user_id: "b", home_score: 100, away_score: 90 }),
      matchup({ home_user_id: "b", away_user_id: "a", week: 2, home_score: 120, away_score: 80 }),
      matchup({ home_user_id: "a", away_user_id: "b", week: 3, home_score: 50, away_score: 50 }),
    ]);

    const a = standings.get("a")!;
    expect(a.wins).toBe(1);
    expect(a.losses).toBe(1);
    expect(a.ties).toBe(1);
    expect(a.pointsFor).toBe(100 + 80 + 50);
    expect(a.pointsAgainst).toBe(90 + 120 + 50);
    expect(a.h2hWins.get("b")).toBe(1);
    expect(standings.get("b")!.h2hWins.get("a")).toBe(1);
  });

  it("ignores playoff matchups", () => {
    const standings = matchupsToStandingsMap([
      matchup({ home_user_id: "a", away_user_id: "b" }),
      matchup({
        home_user_id: "a",
        away_user_id: "b",
        week: 15,
        is_playoff: true,
        playoff_round: PlayoffRound.Finals,
      }),
    ]);
    expect(standings.get("a")!.wins).toBe(1);
  });
});

describe("sortStandingsMap tiebreakers", () => {
  it("orders by wins first", () => {
    const standings = matchupsToStandingsMap([
      matchup({ home_user_id: "winner", away_user_id: "loser" }),
      matchup({ home_user_id: "winner", away_user_id: "loser", week: 2 }),
    ]);
    expect(sortStandingsMap(standings).map((s) => s.userId)).toEqual(["winner", "loser"]);
  });

  it("breaks a tie on head-to-head before points for", () => {
    // "a" and "b" both finish 1-1, and they are the only teams on one win.
    // "b" beat "a" head-to-head while scoring far fewer points overall, so
    // head-to-head has to outrank points for.
    const standings = matchupsToStandingsMap([
      matchup({ home_user_id: "b", away_user_id: "a", home_score: 80, away_score: 70 }),
      matchup({ home_user_id: "a", away_user_id: "d", week: 2, home_score: 200, away_score: 10 }),
      matchup({ home_user_id: "e", away_user_id: "b", week: 3, home_score: 100, away_score: 10 }),
      matchup({ home_user_id: "e", away_user_id: "d", week: 4, home_score: 100, away_score: 10 }),
    ]);

    expect(standings.get("a")!.pointsFor).toBeGreaterThan(standings.get("b")!.pointsFor);

    const oneWin = sortStandingsMap(standings).filter((s) => s.wins === 1);
    expect(oneWin.map((s) => s.userId)).toEqual(["b", "a"]);
  });

  it("falls back to points for when head-to-head is level", () => {
    const standings = matchupsToStandingsMap([
      matchup({ home_user_id: "high", away_user_id: "x", home_score: 150, away_score: 10 }),
      matchup({ home_user_id: "low", away_user_id: "y", home_score: 100, away_score: 10 }),
    ]);
    const sorted = sortStandingsMap(standings).filter((s) => s.wins === 1);
    expect(sorted.map((s) => s.userId)).toEqual(["high", "low"]);
  });
});

describe("standingsForLeague", () => {
  const regularSeason: Matchup[] = [];
  const teams = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"];
  // Give every team a distinct record: t1 best, t8 worst.
  teams.forEach((team, i) => {
    for (let w = 0; w < teams.length - i; w++) {
      regularSeason.push(
        matchup({
          home_user_id: team,
          away_user_id: "bye",
          week: w + 1,
          home_score: 100,
          away_score: 50,
        }),
      );
    }
  });

  it("throws for a pending league", () => {
    expect(() => standingsForLeague(league(LeagueStatus.Pending), [])).toThrow(
      /has not started/,
    );
  });

  it("uses regular season order for an in-progress league", () => {
    const { standings, usedPlayoffResults } = standingsForLeague(
      league(LeagueStatus.InProgress),
      regularSeason,
    );
    expect(usedPlayoffResults).toBe(false);
    expect(standings[0]!.userId).toBe("t1");
  });

  it("uses playoff results for the top six of a complete league", () => {
    const playoffs: Matchup[] = [
      matchup({
        home_user_id: "t4",
        away_user_id: "t5",
        week: 15,
        is_playoff: true,
        playoff_round: PlayoffRound.Quarterfinals,
        home_score: 100,
        away_score: 90,
      }),
      matchup({
        home_user_id: "t3",
        away_user_id: "t6",
        week: 15,
        is_playoff: true,
        playoff_round: PlayoffRound.Quarterfinals,
        home_score: 100,
        away_score: 90,
      }),
      matchup({
        home_user_id: "t2",
        away_user_id: "t1",
        week: 17,
        is_playoff: true,
        playoff_round: PlayoffRound.Finals,
        home_score: 100,
        away_score: 90,
      }),
      matchup({
        home_user_id: "t3",
        away_user_id: "t4",
        week: 17,
        is_playoff: true,
        playoff_round: PlayoffRound.ThirdPlace,
        home_score: 100,
        away_score: 90,
      }),
    ];

    const { standings, usedPlayoffResults } = standingsForLeague(
      league(LeagueStatus.Complete),
      [...regularSeason, ...playoffs],
    );

    expect(usedPlayoffResults).toBe(true);
    // Finals winner, finals loser, third place winner, third place loser,
    // then the two quarterfinal losers.
    expect(standings.slice(0, 4).map((s) => s.userId)).toEqual(["t2", "t1", "t3", "t4"]);
    expect(standings.slice(4, 6).map((s) => s.userId).sort()).toEqual(["t5", "t6"]);
  });

  it("falls back to regular season order when a complete league has no playoff data", () => {
    const { standings, usedPlayoffResults } = standingsForLeague(
      league(LeagueStatus.Complete),
      regularSeason,
    );
    expect(usedPlayoffResults).toBe(false);
    expect(standings[0]!.userId).toBe("t1");
  });
});
