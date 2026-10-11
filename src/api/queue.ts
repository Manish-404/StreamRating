import { browser } from 'wxt/browser';

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface ThrottleOptions {
  /** At most this many requests start within any `perMs` window. */
  maxRequests: number;
  perMs: number;
  /** At most this many requests run at the same time. */
  maxConcurrent?: number;
}

/** Sliding-window rate limiter. `now` and `sleepFn` can be replaced so tests run on a fake clock. */
export class Throttle {
  private starts: number[] = [];
  private active = 0;
  private gate: Promise<void> = Promise.resolve();

  constructor(
    private opts: ThrottleOptions,
    private now: () => number = Date.now,
    private sleepFn: (ms: number) => Promise<void> = sleep,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.active--;
    }
  }

  /** Callers queue up one at a time, so the order requests were made in is kept. */
  private acquire(): Promise<void> {
    const ticket = this.gate.then(() => this.waitForSlot());
    this.gate = ticket.catch(() => {});
    return ticket;
  }

  private async waitForSlot(): Promise<void> {
    const maxConcurrent = this.opts.maxConcurrent ?? Infinity;
    for (;;) {
      const now = this.now();
      this.starts = this.starts.filter((t) => now - t < this.opts.perMs);
      const windowFull = this.starts.length >= this.opts.maxRequests;
      if (!windowFull && this.active < maxConcurrent) {
        this.starts.push(now);
        this.active++;
        return;
      }
      const oldest = this.starts[0];
      const wait = windowFull && oldest !== undefined ? oldest + this.opts.perMs - now : 25;
      await this.sleepFn(Math.max(wait, 1));
    }
  }
}

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
}

export const browserLocalStore: KeyValueStore = {
  async get<T>(key: string) {
    const result = await browser.storage.local.get(key);
    return result[key] as T | undefined;
  },
  async set<T>(key: string, value: T) {
    await browser.storage.local.set({ [key]: value });
  },
};

export const localDate = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

export interface QuotaUsage {
  used: number;
  limit: number;
  remaining: number;
}

/** Counts calls against a per-day allowance (OMDb's free key allows 1,000 a day). The count survives restarts. */
export class DailyQuota {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private store: KeyValueStore,
    private storageKey: string,
    readonly limit: number,
    private today: () => string = localDate,
  ) {}

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(() => fn());
    this.chain = result.catch(() => {});
    return result;
  }

  private async load(): Promise<{ date: string; used: number }> {
    const saved = await this.store.get<{ date: string; used: number }>(this.storageKey);
    const date = this.today();
    return saved && saved.date === date ? saved : { date, used: 0 };
  }

  usage(): Promise<QuotaUsage> {
    return this.serialize(async () => {
      const { used } = await this.load();
      return { used, limit: this.limit, remaining: Math.max(this.limit - used, 0) };
    });
  }

  /** Takes one call from today's allowance. Returns false when nothing is left. */
  tryConsume(): Promise<boolean> {
    return this.serialize(async () => {
      const state = await this.load();
      if (state.used >= this.limit) return false;
      await this.store.set(this.storageKey, { date: state.date, used: state.used + 1 });
      return true;
    });
  }

  /** Called when the server says the limit is reached, even if our own count says otherwise. */
  markExhausted(): Promise<void> {
    return this.serialize(async () => {
      await this.store.set(this.storageKey, { date: this.today(), used: this.limit });
    });
  }
}
