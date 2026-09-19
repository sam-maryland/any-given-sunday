import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseClient } from "./supabase";
import { NewMatchup } from "../domain/types";

let responses: Response[];
let requests: { url: string; method: string; prefer: string | null }[];

function stubFetch() {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      prefer: headers.get("Prefer"),
    });
    return responses.shift() ?? new Response("[]");
  });
}

const matchup: NewMatchup = {
  year: 2026,
  week: 1,
  is_playoff: false,
  playoff_round: null,
  home_user_id: "u1",
  away_user_id: "u2",
  home_seed: null,
  away_seed: null,
  home_score: 100,
  away_score: 90,
};

beforeEach(() => {
  responses = [];
  requests = [];
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SupabaseClient write responses", () => {
  const db = () => new SupabaseClient("https://example.supabase.co", "service-key");

  it("accepts the empty 201 PostgREST returns for a minimal insert", async () => {
    // The real shape: `Prefer: return=minimal` yields 201 with a zero-byte
    // body. Parsing that as JSON threw and aborted the weekly recap after it
    // had already written the rows.
    responses = [new Response("", { status: 201 })];
    await expect(db().insertMatchups([matchup])).resolves.toBeUndefined();
    expect(requests[0]?.prefer).toBe("return=minimal");
  });

  it("accepts a 204 with no body", async () => {
    responses = [new Response(null, { status: 204 })];
    await expect(
      db().updateMatchupScores("m1", { home_score: 1, away_score: 2 }),
    ).resolves.toBeUndefined();
  });

  it("still parses a body when one comes back", async () => {
    responses = [new Response(JSON.stringify([{ id: "u1" }]), { status: 200 })];
    await expect(db().linkDiscordToSleeperUser("u1", "d1")).resolves.toBe(true);
  });

  it("writes nothing when there are no rows", async () => {
    await db().insertMatchups([]);
    expect(requests).toHaveLength(0);
  });

  it("reports a failed write with its status and body", async () => {
    responses = [new Response("violates foreign key constraint", { status: 409 })];
    await expect(db().insertMatchups([matchup])).rejects.toThrow(/409.*foreign key/);
  });
});
