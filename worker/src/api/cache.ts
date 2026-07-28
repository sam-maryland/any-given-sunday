/**
 * A small in-isolate memo for values that are expensive to derive and change
 * on a known schedule.
 *
 * This is deliberately not the Cache API: the Worker is deployed to
 * workers.dev, where Cache API operations have no effect. It is also not KV,
 * because the values here are cheap to rebuild — the cost being avoided is a
 * handful of Supabase and Sleeper round-trips per page load, not computation.
 *
 * Consequences of living in an isolate: entries are per-colo, and are lost on
 * eviction and on every deploy. A cold isolate rebuilds once. That is a fine
 * trade for a league-sized audience, but it means this can never be relied on
 * for correctness — only for latency.
 */

export interface MemoOptions {
  /** Entries to retain before evicting the least recently written. */
  maxEntries?: number;
  /**
   * How long an entry may be served within a single epoch. The epoch already
   * covers scheduled changes; this bounds how long an out-of-band edit (a
   * commissioner tagging playoff results by hand, say) can stay hidden.
   */
  maxAgeMs?: number;
}

export interface MemoResult<T> {
  value: T;
  hit: boolean;
}

interface Entry {
  epoch: number;
  storedAt: number;
  value: Promise<unknown>;
}

export type Memo = <T>(
  key: string,
  epoch: number,
  now: number,
  load: () => Promise<T>,
) => Promise<MemoResult<T>>;

/**
 * Builds a memo with its own storage. Callers hold one at module scope; tests
 * make their own so they never share state.
 *
 * The in-flight promise is stored rather than the resolved value, so requests
 * that arrive together on a cold isolate share one load instead of racing.
 * A rejected load is evicted, so failures are never served from cache.
 */
export function createMemo(options: MemoOptions = {}): Memo {
  const maxEntries = options.maxEntries ?? 24;
  const maxAgeMs = options.maxAgeMs ?? 60 * 60 * 1000;
  const entries = new Map<string, Entry>();

  return async function memo<T>(
    key: string,
    epoch: number,
    now: number,
    load: () => Promise<T>,
  ): Promise<MemoResult<T>> {
    const existing = entries.get(key);
    if (existing && existing.epoch === epoch && now - existing.storedAt < maxAgeMs) {
      return { value: (await existing.value) as T, hit: true };
    }

    const value = load();
    // Re-inserting moves the key to the end, so iteration order stays
    // least-recently-written first for eviction below.
    entries.delete(key);
    entries.set(key, { epoch, storedAt: now, value });

    value.catch(() => {
      // Only evict our own entry — a later request may already have replaced it.
      if (entries.get(key)?.value === value) {
        entries.delete(key);
      }
    });

    // `key` is partly caller-supplied (the ?year= parameter), so the map has
    // to be bounded rather than growing with whatever gets requested.
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done) {
        break;
      }
      entries.delete(oldest.value);
    }

    return { value: (await value) as T, hit: false };
  };
}
