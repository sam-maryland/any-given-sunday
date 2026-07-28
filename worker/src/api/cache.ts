/**
 * Edge caching for derived JSON, keyed on the epoch of the data it was built
 * from.
 *
 * Putting the epoch in the cache key means nothing ever has to send a purge:
 * when the underlying data changes on its known schedule, the key changes and
 * every colo misses at once. Stale entries under old keys age out on their own.
 *
 * This replaces an earlier in-isolate memo. That version was invisible in
 * production — Cache API operations have no effect on workers.dev — and was
 * per-isolate even where it did work, so it was lost on eviction and on every
 * deploy. Backed by the real cache, an entry survives both and is shared by
 * every request reaching the same colo. It is still per-colo, not global: a
 * viewer routed elsewhere gets their own miss.
 */

export interface CachedJsonOptions<T> {
  /** Full URL string identifying this entry. Must include the data epoch. */
  key: string;
  ctx: ExecutionContext;
  /** How long a browser may reuse its copy, in seconds. */
  browserMaxAge: number;
  /**
   * How long the edge may reuse its copy, in seconds. The epoch already covers
   * scheduled changes; this bounds how long an out-of-band edit stays hidden.
   */
  edgeMaxAge: number;
  load: () => Promise<T>;
}

/**
 * Builds a cache key on the request's own origin, so entries stay on a
 * hostname this Worker actually serves.
 */
export function epochCacheKey(url: URL, epoch: number, params: Record<string, string>): string {
  const key = new URL(url.pathname, url.origin);
  for (const [name, value] of Object.entries(params)) {
    key.searchParams.set(name, value);
  }
  key.searchParams.set("epoch", String(epoch));
  return key.toString();
}

/**
 * Cache-aside around a JSON payload. Returns the cached response when there is
 * one, otherwise loads, stores, and returns a fresh one.
 *
 * A failing load is propagated and nothing is written, so an outage or a
 * missing record can never be pinned in the cache. Only resolved plain data
 * is stored — never a promise or anything holding an I/O handle, which
 * Workers scopes to the request that created it.
 */
export async function cachedJsonResponse<T>(options: CachedJsonOptions<T>): Promise<Response> {
  const cache = caches.default;

  const hit = await cache.match(options.key);
  if (hit) {
    // Headers on a cached Response are immutable, so rebuild it to tag X-Cache.
    const response = new Response(hit.body, hit);
    response.headers.set("X-Cache", "HIT");
    return response;
  }

  const value = await options.load();

  const response = new Response(JSON.stringify(value), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${options.browserMaxAge}, s-maxage=${options.edgeMaxAge}`,
    },
  });

  // Clone before tagging, so the stored copy carries no X-Cache of its own and
  // a later hit is not served the word "MISS".
  options.ctx.waitUntil(cache.put(options.key, response.clone()));
  response.headers.set("X-Cache", "MISS");

  return response;
}
