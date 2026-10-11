import { db } from './schema';

const DAY = 24 * 60 * 60 * 1000;

/** How long each kind of cached result stays fresh. */
export const TTL = {
  match: 30 * DAY,
  tmdb: 7 * DAY,
  ratings: 7 * DAY,
  reviews: 14 * DAY,
  recs: DAY,
} as const;

const inFlight = new Map<string, Promise<unknown>>();

/** A fixed lifetime, or a function that picks the lifetime from the stored value (misses can expire sooner). */
export type Ttl<T> = number | ((value: T) => number);

export async function cacheGet<T>(key: string, ttl: Ttl<T>, now = Date.now()): Promise<T | undefined> {
  const row = await db.cache.get(key);
  if (!row) return undefined;
  const ttlMs = typeof ttl === 'function' ? ttl(row.data as T) : ttl;
  return now - row.fetchedAt > ttlMs ? undefined : (row.data as T);
}

export async function cacheSet<T>(key: string, data: T, now = Date.now()): Promise<void> {
  await db.cache.put({ key, fetchedAt: now, data });
}

/**
 * Returns the fresh cached value, or runs `loader` and caches its result. Concurrent calls for the same key
 * share one loader run, so many cards for the same title cost one request. `undefined` is never cached.
 */
export function cached<T>(key: string, ttl: Ttl<T>, loader: () => Promise<T>): Promise<T> {
  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const run = (async () => {
    const hit = await cacheGet<T>(key, ttl);
    if (hit !== undefined) return hit;
    const value = await loader();
    if (value !== undefined) await cacheSet(key, value);
    return value;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

/** Deletes cache rows older than `maxAgeMs`. Returns how many were removed. */
export async function sweepExpired(maxAgeMs = 30 * DAY, now = Date.now()): Promise<number> {
  return db.cache.where('fetchedAt').below(now - maxAgeMs).delete();
}
