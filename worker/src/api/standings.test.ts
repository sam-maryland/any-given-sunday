import { describe, expect, it } from "vitest";
import { standingsPayload } from "./standings";
import { Standing } from "../domain/standings";
import { League, LeagueStatus, User, UserMap } from "../domain/types";

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

function standing(userId: string, overrides: Partial<Standing> = {}): Standing {
  return {
    userId,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    h2hWins: new Map(),
    ...overrides,
  };
}

function users(...ids: string[]): UserMap {
  return new Map(
    ids.map((id): [string, User] => [
      id,
      { id, name: `Team ${id.toUpperCase()}`, discord_id: null, onboarding_complete: true, email: null },
    ]),
  );
}

describe("standingsPayload", () => {
  it("ranks teams in the order the domain sorted them and resolves names", () => {
    const payload = standingsPayload(
      league(LeagueStatus.InProgress),
      [
        standing("a", { wins: 3, losses: 1, pointsFor: 400.5, pointsAgainst: 380.2 }),
        standing("b", { wins: 2, losses: 2, ties: 1 }),
      ],
      users("a", "b"),
      false,
    );

    expect(payload.standings.map((s) => [s.rank, s.name])).toEqual([
      [1, "Team A"],
      [2, "Team B"],
    ]);
    expect(payload.standings[0]).toMatchObject({
      wins: 3,
      losses: 1,
      pointsFor: 400.5,
      pointsAgainst: 380.2,
    });
  });

  it("falls back to the user id when the user row is missing", () => {
    const payload = standingsPayload(
      league(LeagueStatus.InProgress),
      [standing("ghost")],
      users(),
      false,
    );

    expect(payload.standings[0]!.name).toBe("ghost");
  });

  it("rounds away float drift from summed scores", () => {
    const payload = standingsPayload(
      league(LeagueStatus.InProgress),
      [standing("a", { pointsFor: 0.1 + 0.2, pointsAgainst: 100.04 })],
      users("a"),
      false,
    );

    expect(payload.standings[0]!.pointsFor).toBe(0.3);
    expect(payload.standings[0]!.pointsAgainst).toBe(100);
  });

  it("marks the playoff cut line only while a season is in progress", () => {
    const live = standingsPayload(league(LeagueStatus.InProgress), [], users(), false);
    expect(live.playoffCutoff).toBe(6);

    const done = standingsPayload(league(LeagueStatus.Complete), [], users(), true);
    expect(done.playoffCutoff).toBeNull();
  });

  it("passes through the playoff-results caveat for completed seasons", () => {
    const payload = standingsPayload(league(LeagueStatus.Complete), [], users(), false);

    expect(payload.status).toBe(LeagueStatus.Complete);
    expect(payload.usedPlayoffResults).toBe(false);
  });
});
