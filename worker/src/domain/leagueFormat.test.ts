import { describe, expect, it } from "vitest";
import { AGS_FORMAT, byesFor, formatFromSleeper, formatOf } from "./leagueFormat";

describe("byesFor", () => {
  it("gives byes to fill the bracket up to a power of two", () => {
    expect(byesFor(4)).toBe(0);
    expect(byesFor(6)).toBe(2);
    expect(byesFor(8)).toBe(0);
    expect(byesFor(10)).toBe(6);
    expect(byesFor(0)).toBe(0);
  });
});

describe("formatFromSleeper", () => {
  it("reads the league type, playoff field and median game from Sleeper", () => {
    expect(formatFromSleeper({ type: 0, playoff_teams: 4, league_average_match: 1 }, "any")).toEqual({
      type: "redraft",
      playoffTeams: 4,
      byes: 0,
      tiebreaker: "pointsFor",
      medianGame: true,
      placementGamesThrough: null,
      payouts: null,
    });
    expect(formatFromSleeper({ type: 1 }, "any").type).toBe("keeper");
    expect(formatFromSleeper({ type: 2 }, "any").type).toBe("dynasty");
  });

  it("applies Any Given Sunday's own rules, keyed by its first season", () => {
    const format = formatFromSleeper({ type: 2, playoff_teams: 6 }, "996999191685566464");
    expect(format).toEqual(AGS_FORMAT);
  });
});

describe("formatOf", () => {
  it("falls back to Any Given Sunday's format for a league read from Supabase", () => {
    expect(formatOf({})).toBe(AGS_FORMAT);
  });
});
