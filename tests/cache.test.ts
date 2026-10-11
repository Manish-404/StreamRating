import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheGet, cacheSet, cached, sweepExpired } from '../src/db/cache';
import { db } from '../src/db/schema';

beforeEach(async () => {
  await db.cache.clear();
});

describe('cache', () => {
  it('returns a value while it is fresh and nothing once it has expired', async () => {
    await cacheSet('k', { a: 1 }, 1000);
    expect(await cacheGet('k', 500, 1400)).toEqual({ a: 1 });
    expect(await cacheGet('k', 500, 1600)).toBeUndefined();
  });

  it('cached() runs the loader once and then serves the stored value', async () => {
    const loader = vi.fn(async () => 'value');
    expect(await cached('k1', 60_000, loader)).toBe('value');
    expect(await cached('k1', 60_000, loader)).toBe('value');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('cached() shares one loader run between simultaneous callers', async () => {
    const loader = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return 42;
    });
    const results = await Promise.all([cached('k2', 60_000, loader), cached('k2', 60_000, loader), cached('k2', 60_000, loader)]);
    expect(results).toEqual([42, 42, 42]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('cached() does not store undefined and does not keep a failed run', async () => {
    const empty = vi.fn(async () => undefined as string | undefined);
    await cached('k3', 60_000, empty);
    await cached('k3', 60_000, empty);
    expect(empty).toHaveBeenCalledTimes(2);

    const failing = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('ok');
    await expect(cached('k4', 60_000, failing)).rejects.toThrow('network');
    expect(await cached('k4', 60_000, failing)).toBe('ok');
  });

  it('sweepExpired removes only old rows', async () => {
    await cacheSet('old', 1, 1000);
    await cacheSet('new', 2, 9000);
    expect(await sweepExpired(5000, 10_000)).toBe(1);
    expect(await db.cache.count()).toBe(1);
    expect(await cacheGet('new', 5000, 10_000)).toBe(2);
  });
});
