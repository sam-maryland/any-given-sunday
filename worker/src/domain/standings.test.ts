import { describe, expect, it } from "vitest";
import {
  matchupsToStandingsMap,
  sortStandingsMap,
  standingsForLeague,
  standingsToDiscordMessage,
} from "./standings";
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

  it("skips head-to-head when the tied teams have not all played each other", () => {
    // a, b, and c each finish 1-0. a beat c, but b has played neither, so a's
    // head-to-head win must not count: points for decides, and b scored most.
    const standings = matchupsToStandingsMap([
      matchup({ home_user_id: "a", away_user_id: "c", home_score: 100, away_score: 90 }),
      matchup({ home_user_id: "b", away_user_id: "x", week: 2, home_score: 250, away_score: 10 }),
      matchup({ home_user_id: "c", away_user_id: "y", week: 3, home_score: 120, away_score: 10 }),
    ]);

    const oneWin = sortStandingsMap(standings).filter((s) => s.wins === 1);
    expect(oneWin.map((s) => s.userId)).toEqual(["b", "c", "a"]);
  });

  it("puts a team that beat every other tied team first, even if not all played", () => {
    // a, b, and c each finish 2-0 in games that count. a beat b and c; b and c
    // never met. a goes first despite scoring least, then b and c start the
    // tiebreak over: they have not played, so points for decides.
    const standings = matchupsToStandingsMap([
      matchup({ home_user_id: "a", away_user_id: "b", week: 1, home_score: 60, away_score: 50 }),
      matchup({ home_user_id: "a", away_user_id: "c", week: 2, home_score: 60, away_score: 50 }),
      matchup({ home_user_id: "b", away_user_id: "x", week: 3, home_score: 150, away_score: 10 }),
      matchup({ home_user_id: "b", away_user_id: "y", week: 4, home_score: 150, away_score: 10 }),
      matchup({ home_user_id: "c", away_user_id: "x", week: 5, home_score: 200, away_score: 10 }),
      matchup({ home_user_id: "c", away_user_id: "y", week: 6, home_score: 200, away_score: 10 }),
    ]);

    const twoWins = sortStandingsMap(standings).filter((s) => s.wins === 2);
    expect(twoWins.map((s) => s.userId)).toEqual(["a", "c", "b"]);
  });

  it("compares head-to-head by record, so a split series goes to points for", () => {
    const standings = matchupsToStandingsMap([
      matchup({ home_user_id: "a", away_user_id: "b", week: 1, home_score: 100, away_score: 90 }),
      matchup({ home_user_id: "b", away_user_id: "a", week: 2, home_score: 300, away_score: 90 }),
    ]);

    expect(sortStandingsMap(standings).map((s) => s.userId)).toEqual(["b", "a"]);
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

  it("explains seeds, finishes, and playoff-decided order for a complete league", () => {
    const matchups = [...regularSeason, ...playoffs];
    const why = standingsForLeague(league(LeagueStatus.Complete), matchups).explanations;

    expect(why.map((w) => w.seed)).toEqual([2, 1, 3, 4, 5, 6, 7, 8, 9]);
    expect(why.map((w) => w.finish)).toEqual([
      "champion",
      "runnerUp",
      "thirdPlace",
      "fourthPlace",
      "quarterfinal",
      "quarterfinal",
      "missedPlayoffs",
      "missedPlayoffs",
      "missedPlayoffs",
    ]);
    expect(why.map((w) => w.aheadOfNext?.by ?? null)).toEqual([
      "playoffs",
      "playoffs",
      "playoffs",
      "playoffs",
      "wins",
      "playoffs",
      "wins",
      "wins",
      null,
    ]);
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

describe("standingsForLeague explanations", () => {
  const inProgress = league(LeagueStatus.InProgress);
  const explain = (matchups: Matchup[]) => {
    const result = standingsForLeague(inProgress, matchups);
    return result.standings.map((s, i) => ({ userId: s.userId, ...result.explanations[i]! }));
  };
  const rec = (wins: number, losses: number, ties = 0) => ({ wins, losses, ties });

  it("uses head-to-head records when every tied team has played the others", () => {
    // a, b, and c all finish 2-1 and all played each other: a beat both, b
    // beat c. d lost to all three.
    const why = explain([
      matchup({ home_user_id: "a", away_user_id: "b", week: 1 }),
      matchup({ home_user_id: "a", away_user_id: "c", week: 2 }),
      matchup({ home_user_id: "b", away_user_id: "c", week: 3 }),
      matchup({ home_user_id: "b", away_user_id: "d", week: 4 }),
      matchup({ home_user_id: "c", away_user_id: "d", week: 4 }),
      matchup({ home_user_id: "c", away_user_id: "d", week: 5 }),
      matchup({ home_user_id: "d", away_user_id: "a", week: 5 }),
    ]);

    expect(why.map((w) => w.userId)).toEqual(["a", "b", "c", "d"]);
    expect(why[0]!.aheadOfNext).toEqual({
      by: "headToHead",
      headToHead: { used: true, records: [rec(2, 0), rec(1, 1)] },
    });
    expect(why[1]!.aheadOfNext).toEqual({
      by: "headToHead",
      headToHead: { used: true, records: [rec(1, 1), rec(0, 2)] },
    });
    expect(why[2]!.aheadOfNext).toEqual({ by: "wins", headToHead: null });
    expect(why[3]!.aheadOfNext).toBeNull();
    expect(why[0]!.tie).toEqual({ size: 3, record: rec(2, 0), allPlayed: true });
    expect(why[3]!.tie).toBeNull();
    expect(why.map((w) => w.seed)).toEqual([1, 2, 3, 4]);
  });

  it("says head-to-head was skipped when the tied teams have not all met", () => {
    const why = explain([
      matchup({ home_user_id: "a", away_user_id: "c", home_score: 100, away_score: 90 }),
      matchup({ home_user_id: "b", away_user_id: "x", week: 2, home_score: 250, away_score: 10 }),
      matchup({ home_user_id: "c", away_user_id: "y", week: 3, home_score: 120, away_score: 10 }),
    ]);

    expect(why[0]).toMatchObject({
      userId: "b",
      aheadOfNext: { by: "pointsFor", headToHead: { used: false, records: [rec(0, 0), rec(0, 1)] } },
      tie: { size: 3, record: rec(0, 0), allPlayed: false },
    });
  });

  it("names a sweep, then restarts the tiebreak for the rest", () => {
    const why = explain([
      matchup({ home_user_id: "a", away_user_id: "b", week: 1, home_score: 60, away_score: 50 }),
      matchup({ home_user_id: "a", away_user_id: "c", week: 2, home_score: 60, away_score: 50 }),
      matchup({ home_user_id: "b", away_user_id: "x", week: 3, home_score: 150, away_score: 10 }),
      matchup({ home_user_id: "b", away_user_id: "y", week: 4, home_score: 150, away_score: 10 }),
      matchup({ home_user_id: "c", away_user_id: "x", week: 5, home_score: 200, away_score: 10 }),
      matchup({ home_user_id: "c", away_user_id: "y", week: 6, home_score: 200, away_score: 10 }),
    ]);

    expect(why.slice(0, 3).map((w) => [w.userId, w.aheadOfNext?.by])).toEqual([
      ["a", "headToHeadSweep"],
      ["c", "pointsFor"],
      ["b", "wins"],
    ]);
  });

  it("falls through to points against", () => {
    const why = explain([
      matchup({ home_user_id: "a", away_user_id: "x", home_score: 100, away_score: 90 }),
      matchup({ home_user_id: "b", away_user_id: "y", home_score: 100, away_score: 80 }),
    ]);

    expect(why.map((w) => w.userId).slice(0, 2)).toEqual(["b", "a"]);
    expect(why[0]!.aheadOfNext?.by).toBe("pointsAgainst");
  });

  it("owns up to a coin flip when everything is level", () => {
    const why = explain([
      matchup({ home_user_id: "a", away_user_id: "x" }),
      matchup({ home_user_id: "b", away_user_id: "y" }),
    ]);

    expect(why[0]!.aheadOfNext?.by).toBe("coinFlip");
  });
});

describe("standingsToDiscordMessage", () => {
  it("notes spots decided by a tiebreaker and states the rule", () => {
    const l = league(LeagueStatus.InProgress);
    const result = standingsForLeague(l, [
      matchup({ home_user_id: "a", away_user_id: "x", home_score: 150, away_score: 10 }),
      matchup({ home_user_id: "b", away_user_id: "y", home_score: 100, away_score: 10 }),
    ]);
    const users = new Map(
      ["a", "b", "x", "y"].map((id) => [
        id,
        { id, name: `Team ${id.toUpperCase()}`, discord_id: null, onboarding_complete: true, email: null },
      ]),
    );

    const message = standingsToDiscordMessage(result, l, users);

    expect(message).toContain("-# ↳ ahead of Team B on points for");
    expect(message).toContain("only if every tied team has played the others, or one beat them all");
    // B is ahead of Y on wins, which needs no note.
    expect(message).not.toContain("ahead of Team Y");
  });

  it("links to that season's standings page, tiebreaks or not", () => {
    const l = league(LeagueStatus.InProgress);
    const result = standingsForLeague(l, [
      matchup({ home_user_id: "a", away_user_id: "b", home_score: 150, away_score: 10 }),
    ]);

    const message = standingsToDiscordMessage(result, l, new Map());

    expect(message).toContain(`<https://ags-hq.org/?year=${l.year}>`);
  });
});
