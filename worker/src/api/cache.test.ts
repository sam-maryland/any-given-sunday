import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedJsonResponse, epochCacheKey } from "./cache";

/**
 * A stand-in for `caches.default`. Plain vitest has no Workers runtime, so
 * these tests pin the cache-aside logic — what gets stored, what does not, and
 * how responses are tagged — rather than Cloudflare's caching behaviour itself.
 */
function fakeCache() {
  const stored = new Map<string, Response>();
  return {
    stored,
    match: vi.fn(async (key: string) => stored.get(key)?.clone()),
    put: vi.fn(async (key: string, response: Response) => {
      stored.set(key, response);
    }),
  };
}

let cache: ReturnType<typeof fakeCache>;
const waited: Promise<unknown>[] = [];
const ctx = {
  waitUntil: (p: Promise<unknown>) => waited.push(p),
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const flush = () => Promise.all(waited.splice(0));

beforeEach(() => {
  cache = fakeCache();
  waited.length = 0;
  vi.stubGlobal("caches", { default: cache });
});

afterEach(() => vi.unstubAllGlobals());

const options = (load: () => Promise<unknown>, key = "https://ags-hq.org/api/standings?epoch=1") => ({
  key,
  ctx,
  browserMaxAge: 300,
  edgeMaxAge: 3600,
  load,
});

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
  it("loads and stores on a miss", async () => {
    const load = vi.fn(async () => ({ teams: 10 }));

    const res = await cachedJsonResponse(options(load));
    await flush();

    expect(res.headers.get("X-Cache")).toBe("MISS");
    expect(await res.json()).toEqual({ teams: 10 });
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it("serves a stored entry without loading again", async () => {
    const load = vi.fn(async () => ({ teams: 10 }));

    await cachedJsonResponse(options(load));
    await flush();
    const second = await cachedJsonResponse(options(load));

    expect(load).toHaveBeenCalledTimes(1);
    expect(second.headers.get("X-Cache")).toBe("HIT");
    expect(await second.json()).toEqual({ teams: 10 });
  });

  it("stores no X-Cache header, so a later hit is not labelled MISS", async () => {
    await cachedJsonResponse(options(async () => ({ teams: 10 })));
    await flush();

    const [, storedResponse] = cache.put.mock.calls[0]!;
    expect(storedResponse.headers.get("X-Cache")).toBeNull();
  });

  it("sets both a browser and an edge max age", async () => {
    const res = await cachedJsonResponse(options(async () => ({})));
    await flush();

    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=3600");
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("stores nothing when the load fails", async () => {
    const load = vi.fn().mockRejectedValue(new Error("supabase down"));

    await expect(cachedJsonResponse(options(load))).rejects.toThrow("supabase down");
    await flush();

    expect(cache.put).not.toHaveBeenCalled();
    expect(cache.stored.size).toBe(0);
  });

  it("retries after a failure rather than serving the error", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("supabase down"))
      .mockResolvedValueOnce({ teams: 10 });

    await expect(cachedJsonResponse(options(load))).rejects.toThrow();
    const retry = await cachedJsonResponse(options(load));
    await flush();

    expect(retry.headers.get("X-Cache")).toBe("MISS");
    expect(await retry.json()).toEqual({ teams: 10 });
  });

  it("keeps entries under different keys apart", async () => {
    const load = vi.fn(async () => ({ teams: 10 }));

    await cachedJsonResponse(options(load, "https://ags-hq.org/api/standings?epoch=1"));
    await flush();
    const other = await cachedJsonResponse(
      options(load, "https://ags-hq.org/api/standings?epoch=2"),
    );

    expect(other.headers.get("X-Cache")).toBe("MISS");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("writes to the cache without blocking the response", async () => {
    let released!: () => void;
    cache.put.mockImplementation(
      () => new Promise<void>((resolve) => (released = () => resolve())),
    );

    // Resolves even though the put is still outstanding.
    const res = await cachedJsonResponse(options(async () => ({})));

    expect(res.headers.get("X-Cache")).toBe("MISS");
    expect(waited).toHaveLength(1);
    released();
    await flush();
  });
});
