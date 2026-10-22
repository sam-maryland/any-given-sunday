import { describe, expect, it } from "vitest";
import { SleeperBracketMatch } from "../data/sleeper";
import { playoffOutcome, roundFromFinal } from "./sleeperMatchups";
import { PlayoffRound } from "./types";

const owners = new Map(Array.from({ length: 12 }, (_, i) => [i + 1, `u${i + 1}`]));

// Any Given Sunday's 2025 winners bracket, as Sleeper returned it: six teams,
// seeds 1 and 2 (rosters 4 and 8) on byes, and a fifth place game.
const SIX_TEAM: SleeperBracketMatch[] = [
  { m: 1, r: 1, l: 2, w: 6, t1: 6, t2: 2 },
  { m: 2, r: 1, l: 9, w: 3, t1: 9, t2: 3 },
  { m: 3, r: 2, l: 6, w: 4, t1: 4, t2: 6 },
  { m: 4, r: 2, l: 3, w: 8, t1: 8, t2: 3 },
  { p: 5, m: 5, r: 2, l: 2, w: 9, t1: 2, t2: 9 },
  { p: 1, m: 6, r: 3, l: 8, w: 4, t1: 4, t2: 8 },
  { p: 3, m: 7, r: 3, l: 6, w: 3, t1: 6, t2: 3 },
];

describe("roundFromFinal", () => {
  it("names rounds counted back from the final", () => {
    expect(roundFromFinal(0)).toBe(PlayoffRound.Finals);
    expect(roundFromFinal(1)).toBe(PlayoffRound.Semifinals);
    expect(roundFromFinal(2)).toBe(PlayoffRound.Quarterfinals);
    expect(roundFromFinal(3)).toBe(PlayoffRound.FirstRound);
  });
});

describe("playoffOutcome", () => {
  it("places teams by placement game and names the round everyone else went out in", () => {
    expect(playoffOutcome(SIX_TEAM, owners)).toEqual([
      { userId: "u4", place: 1, lostIn: null },
      { userId: "u8", place: 2, lostIn: null },
      { userId: "u3", place: 3, lostIn: PlayoffRound.Semifinals },
      { userId: "u6", place: 4, lostIn: PlayoffRound.Semifinals },
      { userId: "u9", place: 5, lostIn: PlayoffRound.Quarterfinals },
      { userId: "u2", place: 6, lostIn: PlayoffRound.Quarterfinals },
    ]);
  });

  it("handles a four-team bracket", () => {
    const bracket: SleeperBracketMatch[] = [
      { m: 1, r: 1, t1: 1, t2: 4, w: 1, l: 4 },
      { m: 2, r: 1, t1: 2, t2: 3, w: 3, l: 2 },
      { p: 1, m: 3, r: 2, t1: 1, t2: 3, w: 3, l: 1 },
      { p: 3, m: 4, r: 2, t1: 4, t2: 2, w: 4, l: 2 },
    ];
    expect(playoffOutcome(bracket, owners)?.map((p) => [p.userId, p.place])).toEqual([
      ["u3", 1],
      ["u1", 2],
      ["u4", 3],
      ["u2", 4],
    ]);
  });

  it("ignores consolation games when naming the round a team went out in", () => {
    // Eight teams: quarterfinal losers play on for fifth and seventh.
    const bracket: SleeperBracketMatch[] = [
      { m: 1, r: 1, t1: 1, t2: 8, w: 1, l: 8 },
      { m: 2, r: 1, t1: 4, t2: 5, w: 4, l: 5 },
      { m: 3, r: 1, t1: 2, t2: 7, w: 2, l: 7 },
      { m: 4, r: 1, t1: 3, t2: 6, w: 3, l: 6 },
      { m: 5, r: 2, t1: 1, t2: 4, w: 1, l: 4, t1_from: { w: 1 }, t2_from: { w: 2 } },
      { m: 6, r: 2, t1: 2, t2: 3, w: 3, l: 2, t1_from: { w: 3 }, t2_from: { w: 4 } },
      { m: 7, r: 2, t1: 8, t2: 5, w: 5, l: 8, t1_from: { l: 1 }, t2_from: { l: 2 } },
      { m: 8, r: 2, t1: 7, t2: 6, w: 6, l: 7, t1_from: { l: 3 }, t2_from: { l: 4 } },
      { p: 1, m: 9, r: 3, t1: 1, t2: 3, w: 1, l: 3, t1_from: { w: 5 }, t2_from: { w: 6 } },
      { p: 3, m: 10, r: 3, t1: 4, t2: 2, w: 2, l: 4, t1_from: { l: 5 }, t2_from: { l: 6 } },
      { p: 5, m: 11, r: 3, t1: 5, t2: 6, w: 6, l: 5, t1_from: { w: 7 }, t2_from: { w: 8 } },
      { p: 7, m: 12, r: 3, t1: 8, t2: 7, w: 7, l: 8, t1_from: { l: 7 }, t2_from: { l: 8 } },
    ];
    expect(playoffOutcome(bracket, owners)?.map((p) => [p.userId, p.place, p.lostIn])).toEqual([
      ["u1", 1, null],
      ["u3", 2, null],
      ["u2", 3, PlayoffRound.Semifinals],
      ["u4", 4, PlayoffRound.Semifinals],
      ["u6", 5, PlayoffRound.Quarterfinals],
      ["u5", 6, PlayoffRound.Quarterfinals],
      ["u7", 7, PlayoffRound.Quarterfinals],
      ["u8", 8, PlayoffRound.Quarterfinals],
    ]);
  });

  it("is null until the final has a winner", () => {
    const undecided = SIX_TEAM.map((g) => (g.p === 1 ? { ...g, w: null, l: null } : g));
    expect(playoffOutcome(undecided, owners)).toBeNull();
  });
});
