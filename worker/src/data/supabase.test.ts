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

  it("upserts on the natural key so a re-read week rewrites its rows", async () => {
    responses = [new Response("", { status: 201 })];
    await db().upsertRosters([{ league_id: "L", roster_id: 1, user_id: "u1" }]);
    expect(requests[0]?.url).toBe("https://example.supabase.co/rest/v1/rosters?on_conflict=league_id,roster_id");
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.prefer).toBe("resolution=merge-duplicates,return=minimal");
  });

  it("stamps players with the time of the sync", async () => {
    let body: unknown;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? "GET", prefer: null });
      body = JSON.parse(String(init?.body));
      return new Response("", { status: 201 });
    });
    await db().upsertPlayers([{ id: "4046", name: "Patrick Mahomes", position: "QB", team: "KC" }]);
    expect(requests[0]?.url).toBe("https://example.supabase.co/rest/v1/players?on_conflict=id");
    expect(body).toEqual([{ id: "4046", name: "Patrick Mahomes", position: "QB", team: "KC", updated_at: expect.any(String) }]);
  });

  it("writes nothing when there are no rows to upsert", async () => {
    await db().upsertTransactions([]);
    expect(requests).toHaveLength(0);
  });

  it("reports a failed write with its status and body", async () => {
    responses = [new Response("violates foreign key constraint", { status: 409 })];
    await expect(db().insertMatchups([matchup])).rejects.toThrow(/409.*foreign key/);
  });
});

describe("SupabaseClient paged reads", () => {
  const db = () => new SupabaseClient("https://example.supabase.co", "service-key");
  const rows = (n: number, from = 0) => new Response(JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: `t${from + i}` }))));

  it("keeps reading transactions past PostgREST's 1000-row page", async () => {
    responses = [rows(1000), rows(250, 1000)];
    const all = await db().getAllTransactions();
    expect(all).toHaveLength(1250);
    expect(requests.map((r) => new URL(r.url).searchParams.get("offset"))).toEqual(["0", "1000"]);
    expect(new URL(requests[0]!.url).searchParams.get("order")).toBe("id.asc");
  });

  it("asks once more when the last page is exactly full", async () => {
    responses = [rows(1000), rows(0)];
    expect(await db().getAllTransactions()).toHaveLength(1000);
    expect(requests).toHaveLength(2);
  });
});
