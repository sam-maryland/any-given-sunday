import { describe, expect, it } from "vitest";
import { buildLeagueHistory, slugify } from "./history";
import { League, LeagueStatus, NewMatchup, PlayoffRound, User } from "./types";

function league(year: number, status: string, podium: [string, string, string] = ["", "", ""]): League {
  return { id: `L${year}`, year, status, first_place: podium[0], second_place: podium[1], third_place: podium[2] };
}

function game(year: number, week: number, home: string, away: string, homeScore: number, awayScore: number, round: string | null = null): NewMatchup {
  return {
    year,
    week,
    is_playoff: round !== null,
    playoff_round: round,
    home_user_id: home,
    away_user_id: away,
    home_seed: null,
    away_seed: null,
    home_score: homeScore,
    away_score: awayScore,
  };
}

const users = new Map(
  ["a", "b", "c", "d"].map((id): [string, User] => [
    id,
    { id, name: `Owner ${id.toUpperCase()}`, discord_id: null, onboarding_complete: null, email: null },
  ]),
);

// One finished season with a full (tiny) bracket, one in progress.
//   2025: a 2-0, b 1-1, c 1-1, d 0-2. Playoffs: a beats b in the final,
//         c beats d for third.
//   2026: one week in, b beat a.
const leagues = [league(2025, LeagueStatus.Complete, ["a", "b", "c"]), league(2026, LeagueStatus.InProgress)];
const matchups = [
  game(2025, 1, "a", "b", 120, 100),
  game(2025, 1, "c", "d", 90, 80),
  game(2025, 2, "a", "c", 150, 70),
  game(2025, 2, "b", "d", 110, 60),
  game(2025, 3, "c", "d", 101, 99, PlayoffRound.Quarterfinals),
  game(2025, 3, "a", "b", 99, 98, PlayoffRound.Quarterfinals),
  game(2025, 4, "a", "c", 130, 90, PlayoffRound.Semifinals),
  game(2025, 4, "b", "d", 100, 90, PlayoffRound.Semifinals),
  game(2025, 5, "a", "b", 140, 120, PlayoffRound.Finals),
  game(2025, 5, "c", "d", 95, 85, PlayoffRound.ThirdPlace),
  game(2026, 1, "b", "a", 130, 125),
  game(2026, 1, "c", "d", 80, 70),
];

const history = buildLeagueHistory(leagues, matchups, users, new Map([["a", "The Aces"]]));
const owner = (id: string) => history.owners.find((o) => o.userId === id)!;

describe("buildLeagueHistory", () => {
  it("counts regular season and playoff records separately", () => {
    expect(owner("a").record).toEqual({ wins: 2, losses: 1, ties: 0 });
    expect(owner("a").playoffRecord).toEqual({ wins: 3, losses: 0, ties: 0 });
    expect(owner("a").pointsFor).toBe(395);
  });

  it("counts trophies from the recorded podium", () => {
    expect([owner("a").titles, owner("b").runnerUps, owner("c").thirdPlaces]).toEqual([1, 1, 1]);
    expect(history.podiums).toEqual([{ year: 2025, first: "a", second: "b", third: "c" }]);
  });

  it("credits each week's high score", () => {
    // a topped 2025 weeks 1 and 2; b topped 2026 week 1. Playoffs don't count.
    expect(owner("a").highScoreWeeks).toBe(2);
    expect(owner("b").highScoreWeeks).toBe(1);
    expect(owner("d").highScoreWeeks).toBe(0);
  });

  it("works out earnings season by season", () => {
    // 2025: -100 buy-in, 2 high scores at $15, $600 title. 2026: -100.
    expect(owner("a").seasonLines.map((l) => l.earnings)).toEqual([-100 + 30 + 600, -100]);
    expect(owner("a").earnings).toBe(430);
    // b: 2025 runner-up (-100 + 300), 2026 one high score (-100 + 15).
    expect(owner("b").earnings).toBe(115);
    expect(owner("d").earnings).toBe(-200);
  });

  it("takes seeds and finishes from the standings", () => {
    const [done, live] = owner("a").seasonLines;

    expect(done).toMatchObject({ year: 2025, inProgress: false, seed: 1, finish: "champion" });
    expect(live).toMatchObject({ year: 2026, inProgress: true, finish: null });
    expect(owner("a").playoffAppearances).toBe(1);
  });

  it("keeps head-to-head across regular season and playoffs", () => {
    const vsB = owner("a").headToHead.find((h) => h.opponentId === "b")!;

    // Week 1 2025 win, quarterfinal and final wins, 2026 loss.
    expect(vsB.record).toEqual({ wins: 3, losses: 1, ties: 0 });
    expect(vsB.playoffRecord).toEqual({ wins: 2, losses: 0, ties: 0 });
    // Most-played opponent first.
    expect(owner("a").headToHead[0]!.opponentId).toBe("b");
  });

  it("finds league records in the regular season only", () => {
    expect(history.records.highestScore).toMatchObject({ userId: "a", score: 150, year: 2025, week: 2 });
    expect(history.records.biggestBlowout).toMatchObject({ userId: "a", opponentId: "c", score: 150, opponentScore: 70 });
    expect(history.records.highestInLoss).toMatchObject({ userId: "a", score: 125, year: 2026 });
    expect(history.records.closestGame).toMatchObject({ userId: "b", score: 130, opponentScore: 125 });
    expect(history.records.lowestScore).toMatchObject({ userId: "d", score: 60 });
  });

  it("names owners by owner, with the current team name alongside", () => {
    expect(owner("a")).toMatchObject({ name: "Owner A", slug: "owner-a", label: "The Aces" });
    // Sleeper couldn't name b: the owner's own name stands in.
    expect(owner("b").label).toBe("Owner B");
    expect(history.currentYear).toBe(2026);
  });

  it("leaves out users who have never played", () => {
    const withGhost = new Map(users);
    withGhost.set("z", { id: "z", name: "Never Played", discord_id: null, onboarding_complete: null, email: null });

    expect(buildLeagueHistory(leagues, matchups, withGhost, new Map()).owners).toHaveLength(4);
  });
});

describe("slugify", () => {
  it("makes a readable address from a name", () => {
    expect(slugify("Mike O'Neil-Smith")).toBe("mike-o-neil-smith");
    expect(slugify("José Ñúñez")).toBe("jose-nunez");
  });
});
