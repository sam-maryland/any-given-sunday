import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimiter } from "./league";
import { UserNotFoundError, findUserLeagues, groupLeagues, parseUsername } from "./userLeagues";

const league = (id: string, season: string, status: string, previous: string | null = null, name = "Dynasty Bros") => ({
  league_id: id,
  season,
  status,
  name,
  previous_league_id: previous,
  avatar: null,
  settings: {},
});

// One user, offseason after rollover: Sleeper makes leagues for 2027 while
// the NFL season is still 2026. Dynasty Bros has renewed for 2027; Office
// League played 2024 and 2025 and was never renewed; Best Ball is this
// season's only.
const SEASONS: Record<string, object[]> = {
  "2024": [league("O24", "2024", "complete", null, "Office League")],
  "2025": [league("D25", "2025", "complete"), league("O25", "2025", "complete", "O24", "Office League")],
  "2026": [league("D26", "2026", "complete", "D25"), league("B26", "2026", "in_season", null, "Best Ball")],
  "2027": [league("D27", "2027", "pre_draft", "D26")],
};

let requests: string[];
beforeEach(() => {
  requests = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = String(input).replace("https://api.sleeper.app", "");
    requests.push(path);
    const json = (body: unknown) => new Response(JSON.stringify(body));
    if (path === "/v1/state/nfl") return json({ week: 18, season: "2026", season_type: "regular", league_create_season: "2027" });
    if (path === "/v1/user/sam") return json({ user_id: "U1", username: "sam", display_name: "Sam" });
    if (path.startsWith("/v1/user/")) {
      const season = path.match(/^\/v1\/user\/U1\/leagues\/nfl\/(\d+)$/)?.[1];
      return json(season ? (SEASONS[season] ?? []) : null);
    }
    return new Response("nope", { status: 404 });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("parseUsername", () => {
  it("takes a username as typed, with or without the @", () => {
    expect(parseUsername("  sam ")).toBe("sam");
    expect(parseUsername("@sam")).toBe("sam");
    expect(parseUsername("two words")).toBeNull();
    expect(parseUsername("")).toBeNull();
  });
});

describe("groupLeagues", () => {
  it("joins seasons into leagues named by their newest season", () => {
    const leagues = groupLeagues(Object.values(SEASONS).flat() as never);
    expect(leagues.map((l) => [l.id, l.name, l.status, l.seasons])).toEqual([
      ["D27", "Dynasty Bros", "pre_draft", [2027, 2026, 2025]],
      ["B26", "Best Ball", "in_season", [2026]],
      ["O25", "Office League", "complete", [2025, 2024]],
    ]);
  });

  it("puts a league in season ahead of a finished one from the same year", () => {
    const leagues = groupLeagues([league("A", "2026", "complete", null, "A"), league("B", "2026", "in_season", null, "B")] as never);
    expect(leagues.map((l) => l.id)).toEqual(["B", "A"]);
  });
});

describe("findUserLeagues", () => {
  it("asks for every season through the one leagues are being made for", async () => {
    const { user, leagues } = await findUserLeagues("sam");
    expect(user).toEqual({ id: "U1", name: "Sam" });
    expect(leagues.map((l) => l.id)).toEqual(["D27", "B26", "O25"]);
    const asked = requests.flatMap((p) => p.match(/leagues\/nfl\/(\d+)$/)?.[1] ?? []).map(Number);
    expect(Math.max(...asked)).toBe(2027);
    expect(Math.min(...asked)).toBe(2017);
  });

  it("says when Sleeper has no such user", async () => {
    await expect(findUserLeagues("nobody")).rejects.toBeInstanceOf(UserNotFoundError);
  });
});

describe("rateLimiter", () => {
  it("holds a call back until the window has room", async () => {
    const wait = rateLimiter(2, 80);
    const start = Date.now();
    await wait();
    await wait();
    expect(Date.now() - start).toBeLessThan(40);
    await wait();
    expect(Date.now() - start).toBeGreaterThanOrEqual(75);
  });
});
