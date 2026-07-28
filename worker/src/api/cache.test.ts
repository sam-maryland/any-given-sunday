import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { cachedJsonResponse, epochCacheKey } from "./cache";

/**
 * These run inside workerd against the real `caches.default` and a real
 * ExecutionContext — not a stub. That matters: the Cache API behaves in ways
 * a hand-written fake does not, most visibly that headers on a cached Response
 * are immutable, and cache writes only land once waitUntil has settled.
 */

let keySeq = 0;
// Cache state is shared within a run, so each test takes its own key.
const freshKey = () => `https://ags-hq.org/api/standings?test=${keySeq++}`;

async function call<T>(key: string, load: () => Promise<T>) {
  const ctx = createExecutionContext();
  const response = await cachedJsonResponse({
    key,
    ctx,
    browserMaxAge: 300,
    edgeMaxAge: 3600,
    load,
  });
  // Settles the waitUntil the cache write was handed to.
  await waitOnExecutionContext(ctx);
  return response;
}

describe("epochCacheKey", () => {
  it("keys on the request's own origin and path", () => {
    const key = epochCacheKey(new URL("https://ags-hq.org/api/standings?year=2025"), 1234, {
      year: "2025",
    });

    expect(key).toBe("https://ags-hq.org/api/standings?year=2025&epoch=1234");
  });

  it("distinguishes the default from an explicit season", () => {
    const url = new URL("https://ags-hq.org/api/standings");

    expect(epochCacheKey(url, 1, { year: "latest" })).not.toBe(
      epochCacheKey(url, 1, { year: "2025" }),
    );
  });

  it("changes when the epoch rolls over", () => {
    const url = new URL("https://ags-hq.org/api/standings");

    expect(epochCacheKey(url, 1, { year: "latest" })).not.toBe(
      epochCacheKey(url, 2, { year: "latest" }),
    );
  });

  it("drops query parameters that are not part of the key", () => {
    const key = epochCacheKey(new URL("https://ags-hq.org/api/standings?utm_source=discord"), 1, {
      year: "latest",
    });

    expect(key).toBe("https://ags-hq.org/api/standings?year=latest&epoch=1");
  });
});

describe("cachedJsonResponse", () => {
  it("loads on a miss and serves the stored entry on the next call", async () => {
    const key = freshKey();
    const load = vi.fn(async () => ({ teams: 10 }));

    const first = await call(key, load);
    const second = await call(key, load);

    expect(first.headers.get("X-Cache")).toBe("MISS");
    expect(second.headers.get("X-Cache")).toBe("HIT");
    expect(load).toHaveBeenCalledTimes(1);
    expect(await second.json()).toEqual({ teams: 10 });
  });

  it("returns a readable body on a hit, not a consumed one", async () => {
    const key = freshKey();
    const payload = { teams: ["a", "b"], nested: { deep: true } };

    await call(key, async () => payload);
    const hit = await call(key, async () => ({ teams: ["changed"] }));

    expect(await hit.json()).toEqual(payload);
  });

  it("tags a hit as HIT despite cached response headers being immutable", async () => {
    const key = freshKey();

    await call(key, async () => ({}));
    const hit = await call(key, async () => ({}));

    // Reaching this at all proves the implementation rebuilds the Response:
    // mutating headers on the object cache.match returns throws in workerd.
    expect(hit.headers.get("X-Cache")).toBe("HIT");
  });

  it("stores no X-Cache header, so a later hit is not labelled MISS", async () => {
    const key = freshKey();

    await call(key, async () => ({}));
    const stored = await caches.default.match(key);

    expect(stored).toBeDefined();
    expect(stored!.headers.get("X-Cache")).toBeNull();
  });

  it("sets both a browser and an edge max age", async () => {
    const res = await call(freshKey(), async () => ({}));

    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=3600");
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("stores nothing when the load fails", async () => {
    const key = freshKey();
    const load = vi.fn().mockRejectedValue(new Error("supabase down"));

    await expect(call(key, load)).rejects.toThrow("supabase down");

    expect(await caches.default.match(key)).toBeUndefined();
  });

  it("retries after a failure rather than serving the error", async () => {
    const key = freshKey();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("supabase down"))
      .mockResolvedValueOnce({ teams: 10 });

    await expect(call(key, load)).rejects.toThrow();
    const retry = await call(key, load);

    expect(retry.headers.get("X-Cache")).toBe("MISS");
    expect(await retry.json()).toEqual({ teams: 10 });
  });

  it("keeps entries under different keys apart", async () => {
    const load = vi.fn(async () => ({ teams: 10 }));

    await call(freshKey(), load);
    const other = await call(freshKey(), load);

    expect(other.headers.get("X-Cache")).toBe("MISS");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("survives being read from a later, separate request context", async () => {
    const key = freshKey();

    // Each call gets its own ExecutionContext, standing in for a separate
    // request. Only resolved data crosses between them — holding an in-flight
    // promise here is what workerd rejects with "Cannot perform I/O on behalf
    // of a different request".
    await call(key, async () => ({ teams: 10 }));
    const later = await call(key, async () => ({ teams: 999 }));

    expect(await later.json()).toEqual({ teams: 10 });
  });
});
