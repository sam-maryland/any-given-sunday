import { describe, expect, it, vi } from "vitest";
import { createMemo } from "./cache";

const EPOCH = 1_000_000;

describe("createMemo", () => {
  it("loads once and serves the second call from cache", async () => {
    const memo = createMemo();
    const load = vi.fn(async () => "value");

    const first = await memo("k", EPOCH, 0, load);
    const second = await memo("k", EPOCH, 0, load);

    expect(load).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ value: "value", hit: false });
    expect(second).toEqual({ value: "value", hit: true });
  });

  it("reloads when the epoch rolls over", async () => {
    const memo = createMemo();
    const load = vi.fn(async () => "value");

    await memo("k", EPOCH, 0, load);
    const next = await memo("k", EPOCH + 1, 0, load);

    expect(load).toHaveBeenCalledTimes(2);
    expect(next.hit).toBe(false);
  });

  it("keeps separate entries per key", async () => {
    const memo = createMemo();
    const load = vi.fn(async () => "value");

    await memo("a", EPOCH, 0, load);
    await memo("b", EPOCH, 0, load);

    expect(load).toHaveBeenCalledTimes(2);
    expect((await memo("a", EPOCH, 0, load)).hit).toBe(true);
  });

  it("reloads once the entry passes its max age, even within an epoch", async () => {
    const memo = createMemo({ maxAgeMs: 100 });
    const load = vi.fn(async () => "value");

    await memo("k", EPOCH, 0, load);
    expect((await memo("k", EPOCH, 99, load)).hit).toBe(true);
    expect((await memo("k", EPOCH, 100, load)).hit).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
  });

  // Deliberately NOT deduplicated. Sharing one in-flight promise across
  // requests would mean a second request awaiting I/O created in the first
  // request's context, which Workers rejects with "Cannot perform I/O on
  // behalf of a different request". Redundant loads are the safe trade.
  it("lets concurrent misses each run their own load rather than sharing one", async () => {
    const memo = createMemo();
    // One resolver per call: each concurrent miss gets its own promise, so a
    // single shared handle would leave the first load hanging forever.
    const resolvers: ((v: string) => void)[] = [];
    const load = vi.fn(() => new Promise<string>((r) => resolvers.push(r)));

    const both = Promise.all([memo("k", EPOCH, 0, load), memo("k", EPOCH, 0, load)]);
    expect(resolvers).toHaveLength(2);
    resolvers.forEach((r) => r("value"));

    expect((await both).map((r) => r.value)).toEqual(["value", "value"]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("stores resolved data, never the promise it came from", async () => {
    const memo = createMemo();
    const payload = { teams: ["a", "b"] };

    await memo("k", EPOCH, 0, async () => payload);
    const hit = await memo("k", EPOCH, 0, async () => ({ teams: ["changed"] }));

    // A cached hit hands back the plain object itself — nothing to await, and
    // nothing holding a request-scoped I/O handle.
    expect(hit.value).toBe(payload);
    expect(hit.hit).toBe(true);
  });

  it("does not cache a failed load", async () => {
    const memo = createMemo();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("supabase down"))
      .mockResolvedValueOnce("value");

    await expect(memo("k", EPOCH, 0, load)).rejects.toThrow("supabase down");
    const retry = await memo("k", EPOCH, 0, load);

    expect(retry).toEqual({ value: "value", hit: false });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("bounds the map so a caller-supplied key cannot grow it without limit", async () => {
    const memo = createMemo({ maxEntries: 2 });
    const load = vi.fn(async () => "value");

    for (const key of ["a", "b", "c"]) {
      await memo(key, EPOCH, 0, load);
    }

    // "a" was evicted as least recently written; "c" is still resident.
    expect((await memo("c", EPOCH, 0, load)).hit).toBe(true);
    expect((await memo("a", EPOCH, 0, load)).hit).toBe(false);
  });

  it("treats a refreshed key as recently written for eviction", async () => {
    const memo = createMemo({ maxEntries: 2 });
    const load = vi.fn(async () => "value");

    await memo("a", EPOCH, 0, load);
    await memo("b", EPOCH, 0, load);
    await memo("a", EPOCH + 1, 0, load); // refresh moves "a" to newest
    await memo("c", EPOCH, 0, load); // evicts "b"

    expect((await memo("a", EPOCH + 1, 0, load)).hit).toBe(true);
    expect((await memo("b", EPOCH, 0, load)).hit).toBe(false);
  });
});
