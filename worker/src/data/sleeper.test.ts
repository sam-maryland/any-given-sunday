import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTeamNames } from "./sleeper";
import { User, UserMap } from "../domain/types";

function user(id: string, name: string): User {
  return { id, name, discord_id: `d-${id}`, onboarding_complete: true, email: `${id}@x.com` };
}

function dbUsers(...users: User[]): UserMap {
  return new Map(users.map((u) => [u.id, u]));
}

function stubSleeper(body: unknown, status = 200) {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status }));
}

afterEach(() => vi.unstubAllGlobals());

describe("withTeamNames", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

  it("replaces stored names with Sleeper team names", async () => {
    stubSleeper([
      { user_id: "u1", username: "sam", display_name: "Sam", metadata: { team_name: "The Ducks" } },
    ]);

    const merged = await withTeamNames(dbUsers(user("u1", "Sam Maryland")), "L1");

    expect(merged.get("u1")!.name).toBe("The Ducks");
  });

  it("falls back to the Sleeper display name when no team name is set", async () => {
    stubSleeper([{ user_id: "u1", username: "sam", display_name: "Sam", metadata: null }]);

    const merged = await withTeamNames(dbUsers(user("u1", "Sam Maryland")), "L1");

    expect(merged.get("u1")!.name).toBe("Sam");
  });

  it("preserves the database fields the standings and email rely on", async () => {
    stubSleeper([
      { user_id: "u1", username: "sam", display_name: "Sam", metadata: { team_name: "The Ducks" } },
    ]);

    const merged = await withTeamNames(dbUsers(user("u1", "Sam Maryland")), "L1");

    expect(merged.get("u1")).toMatchObject({
      discord_id: "d-u1",
      onboarding_complete: true,
      email: "u1@x.com",
    });
  });

  it("keeps stored names for users no longer in the league", async () => {
    stubSleeper([
      { user_id: "u1", username: "sam", display_name: "Sam", metadata: { team_name: "The Ducks" } },
    ]);

    const merged = await withTeamNames(
      dbUsers(user("u1", "Sam Maryland"), user("u2", "Departed Owner")),
      "L1",
    );

    expect(merged.get("u2")!.name).toBe("Departed Owner");
  });

  it("falls back to stored names when Sleeper is unreachable", async () => {
    stubSleeper({ error: "boom" }, 500);

    const merged = await withTeamNames(dbUsers(user("u1", "Sam Maryland")), "L1");

    expect(merged.get("u1")!.name).toBe("Sam Maryland");
  });

  it("does not mutate the map it was given", async () => {
    stubSleeper([
      { user_id: "u1", username: "sam", display_name: "Sam", metadata: { team_name: "The Ducks" } },
    ]);

    const original = dbUsers(user("u1", "Sam Maryland"));
    await withTeamNames(original, "L1");

    expect(original.get("u1")!.name).toBe("Sam Maryland");
  });
});
