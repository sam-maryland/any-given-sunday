import { describe, expect, it } from "vitest";
import { Pairing, clinchStatus, fitScoreModel, pairingKey, simulatePlayoffRace } from "./playoffRace";
import { NewMatchup } from "./types";

function game(week: number, home: string, away: string, homeScore: number, awayScore: number): NewMatchup {
  return {
    year: 2026,
    week,
    is_playoff: false,
    playoff_round: null,
    home_user_id: home,
    away_user_id: away,
    home_seed: null,
    away_seed: null,
    home_score: homeScore,
    away_score: awayScore,
  };
}

// A small deterministic generator, so simulation tests don't flake.
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("fitScoreModel", () => {
  it("pulls a team's average toward the league's", () => {
    const model = fitScoreModel([game(1, "a", "b", 150, 100), game(2, "a", "b", 150, 100)]);

    // League average 125; "a" averages 150 over 2 games, blended with 3
    // league-average games: (2 * 150 + 3 * 125) / 5.
    expect(model.mean.get("a")).toBeCloseTo(135);
    expect(model.mean.get("b")).toBeCloseTo(115);
  });

  it("measures spread around each team's own average", () => {
    const model = fitScoreModel([game(1, "a", "b", 110, 90), game(2, "a", "b", 130, 110)]);

    // Each team is ±10 around its own mean: 4 squared residuals of 100 over
    // 2 degrees of freedom.
    expect(model.sd).toBeCloseTo(Math.sqrt(200));
  });

  it("ignores playoff games", () => {
    const model = fitScoreModel([game(1, "a", "b", 100, 100), { ...game(14, "a", "b", 300, 0), is_playoff: true }]);

    expect(model.mean.get("a")).toBeCloseTo(100);
  });
});

describe("simulatePlayoffRace", () => {
  // Four teams, one playoff spot. "a" is 2-0, everyone else trails.
  const played = [game(1, "a", "b", 120, 100), game(1, "c", "d", 110, 100), game(2, "a", "c", 120, 100), game(2, "b", "d", 110, 100)];
  const remaining: Pairing[] = [
    { week: 3, homeId: "a", awayId: "d" },
    { week: 3, homeId: "b", awayId: "c" },
  ];
  const base = { played, remaining, playoffTeams: 1, byeTeams: 1, runs: 2000 };

  it("gives every team a full seed distribution", () => {
    const odds = simulatePlayoffRace({ ...base, random: seeded(1) });

    expect(odds.map((o) => o.userId).sort()).toEqual(["a", "b", "c", "d"]);
    for (const o of odds) {
      expect(o.seeds.reduce((x, y) => x + y, 0)).toBeCloseTo(1);
    }
    // Every seed is filled exactly once per run.
    for (let seed = 0; seed < 4; seed++) {
      expect(odds.reduce((sum, o) => sum + o.seeds[seed]!, 0)).toBeCloseTo(1);
    }
  });

  it("makes the leader the favourite", () => {
    const odds = simulatePlayoffRace({ ...base, random: seeded(2) });
    const a = odds.find((o) => o.userId === "a")!;

    expect(a.playoffs).toBeGreaterThan(0.9);
  });

  it("applies a pick: a team that can't catch up stays out", () => {
    // If "a" beats "d", nobody else can reach three wins.
    const picks = new Map([[pairingKey({ week: 3, homeId: "a", awayId: "d" }), "a"]]);
    const odds = simulatePlayoffRace({ ...base, picks, random: seeded(3) });

    expect(odds.find((o) => o.userId === "a")!.playoffs).toBe(1);
    expect(odds.find((o) => o.userId === "a")!.nextGame).toBeNull();
  });

  it("splits odds on a team's next result", () => {
    // Two spots. "b" is 1-1 and plays "c" (1-1): lose, and "a" and "c" both
    // finish with more wins.
    const odds = simulatePlayoffRace({ ...base, playoffTeams: 2, random: seeded(4) });
    const b = odds.find((o) => o.userId === "b")!;

    expect(b.nextGame?.week).toBe(3);
    expect(b.nextGame!.ifWin).toBeGreaterThan(0);
    expect(b.nextGame?.ifLose).toBe(0);
  });

  it("does a full season's remaining schedule quickly enough for a browser", () => {
    const teams = Array.from({ length: 12 }, (_, i) => `t${i}`);
    const random = seeded(5);
    const pairings = (week: number) =>
      teams.slice(0, 6).map((t, i) => ({ week, homeId: t, awayId: teams[(i + week) % 6 + 6]! }));
    const playedSeason = [1, 2, 3, 4, 5, 6].flatMap((w) =>
      pairings(w).map((p) => game(w, p.homeId, p.awayId, 80 + 60 * random(), 80 + 60 * random())),
    );
    const rest = [7, 8, 9, 10, 11, 12].flatMap(pairings);

    const start = performance.now();
    simulatePlayoffRace({ played: playedSeason, remaining: rest, playoffTeams: 6, byeTeams: 2, runs: 10000, random });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5000);
  });
});

describe("clinchStatus", () => {
  // Three teams, one spot, one week left.
  it("clinches a team nobody else can reach", () => {
    const status = clinchStatus(
      [game(1, "a", "b", 1, 0), game(2, "a", "c", 1, 0), game(3, "b", "c", 1, 0)],
      [{ week: 4, homeId: "b", awayId: "c" }],
      1,
      1,
    );
    const by = new Map(status.map((s) => [s.userId, s]));

    // a has 2 wins; b can reach 2, which could tie and win a tiebreak.
    expect(by.get("a")!.playoffs).toBeNull();
    // c (0 wins, max 1) can't pass a's 2.
    expect(by.get("c")!.playoffs).toBe("eliminated");
  });

  it("clinches once the chasers can only tie for fewer wins", () => {
    const status = clinchStatus(
      [game(1, "a", "b", 1, 0), game(2, "a", "c", 1, 0), game(3, "a", "b", 1, 0)],
      [{ week: 4, homeId: "b", awayId: "c" }],
      1,
      1,
    );

    expect(status.find((s) => s.userId === "a")!.playoffs).toBe("clinched");
  });

  it("calls nothing settled with plenty of season left", () => {
    const status = clinchStatus(
      [game(1, "a", "b", 1, 0)],
      [2, 3, 4].map((week) => ({ week, homeId: "a", awayId: "b" })),
      1,
      1,
    );

    expect(status.every((s) => s.playoffs === null)).toBe(true);
  });
});
