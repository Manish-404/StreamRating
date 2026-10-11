import { describe, expect, it } from 'vitest';
import { DailyQuota, Throttle, browserLocalStore, type KeyValueStore } from '../src/api/queue';

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    get time() {
      return t;
    },
  };
}

function memoryStore(): KeyValueStore {
  const data = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return data.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T) {
      data.set(key, value);
    },
  };
}

describe('Throttle', () => {
  it('lets requests through without waiting while under the limit', async () => {
    const clock = fakeClock();
    const throttle = new Throttle({ maxRequests: 3, perMs: 1000 }, clock.now, clock.sleep);
    for (let i = 0; i < 3; i++) await throttle.run(async () => i);
    expect(clock.time).toBe(0);
  });

  it('waits for the window to free up once the limit is reached', async () => {
    const clock = fakeClock();
    const throttle = new Throttle({ maxRequests: 2, perMs: 1000 }, clock.now, clock.sleep);
    await throttle.run(async () => 1);
    await throttle.run(async () => 2);
    await throttle.run(async () => 3);
    expect(clock.time).toBe(1000);
  });

  it('keeps requests in the order they were made', async () => {
    const clock = fakeClock();
    const throttle = new Throttle({ maxRequests: 2, perMs: 1000 }, clock.now, clock.sleep);
    const order: number[] = [];
    await Promise.all([0, 1, 2, 3, 4].map((i) => throttle.run(async () => void order.push(i))));
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it('never runs more than maxConcurrent at once', async () => {
    const throttle = new Throttle({ maxRequests: 100, perMs: 1000, maxConcurrent: 2 });
    let active = 0;
    let peak = 0;
    const task = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 30));
      active--;
    };
    await Promise.all([1, 2, 3, 4, 5].map(() => throttle.run(task)));
    expect(peak).toBe(2);
  });

  it('releases its slot when a request fails', async () => {
    const throttle = new Throttle({ maxRequests: 100, perMs: 1000, maxConcurrent: 1 });
    await expect(throttle.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(throttle.run(async () => 'next')).resolves.toBe('next');
  });
});

describe('DailyQuota', () => {
  it('counts calls and refuses once the limit is used', async () => {
    const quota = new DailyQuota(memoryStore(), 'q', 3, () => '2026-10-10');
    expect(await Promise.all([quota.tryConsume(), quota.tryConsume(), quota.tryConsume()])).toEqual([true, true, true]);
    expect(await quota.tryConsume()).toBe(false);
    expect(await quota.usage()).toEqual({ used: 3, limit: 3, remaining: 0 });
  });

  it('never hands out more than the limit when called in parallel', async () => {
    const quota = new DailyQuota(memoryStore(), 'q', 5, () => '2026-10-10');
    const results = await Promise.all(Array.from({ length: 12 }, () => quota.tryConsume()));
    expect(results.filter(Boolean)).toHaveLength(5);
  });

  it('starts again on a new day', async () => {
    let day = '2026-10-10';
    const quota = new DailyQuota(memoryStore(), 'q', 1, () => day);
    expect(await quota.tryConsume()).toBe(true);
    expect(await quota.tryConsume()).toBe(false);
    day = '2026-10-11';
    expect(await quota.tryConsume()).toBe(true);
  });

  it('can be marked used up when the server says so', async () => {
    const quota = new DailyQuota(memoryStore(), 'q', 1000, () => '2026-10-10');
    await quota.markExhausted();
    expect(await quota.tryConsume()).toBe(false);
  });

  it('browserLocalStore round-trips a value through extension storage', async () => {
    await browserLocalStore.set('probe', { a: 1 });
    expect(await browserLocalStore.get('probe')).toEqual({ a: 1 });
  });
});
