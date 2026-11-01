import { liveQuery } from 'dexie';
import { browser } from 'wxt/browser';
import { db } from '../db/schema';
import { getSyncStatus, runSync } from './service';

const PERIODIC = 'sync-periodic';
const SOON = 'sync-soon';

/** The time of the newest change to anything that is synced. */
const latestChange = async () =>
  (await Promise.all([db.history, db.watchlist, db.reactions, db.matchOverrides].map((t) => t.orderBy('updatedAt').last()))).reduce(
    (latest, r) => Math.max(latest, r?.updatedAt ?? 0),
    0,
  );

/**
 * Plans a sync about a minute from now if something changed since the last good one. Throttled, not debounced: an alarm
 * that already waits is kept, so a stream of progress saves cannot postpone it forever. An alarm, not a timer, because
 * the browser stops the background when it is idle and a timer would die with it.
 */
export async function armSoon(latest?: number): Promise<void> {
  const [status, newest, waiting] = await Promise.all([getSyncStatus(), latest ?? latestChange(), browser.alarms.get(SOON)]);
  if (!status.connected || waiting || newest <= (status.syncedUpTo ?? 0)) return;
  await browser.alarms.create(SOON, { delayInMinutes: 1 });
}

/**
 * When the background syncs: when it starts, every 15 minutes, and about a minute after a change. Because the browser
 * stops and restarts the background, "changed" is judged by comparing record times with the last good sync, not by
 * remembering what was seen. The dashboard calls `syncSoon` after its own edits, which also wakes the background.
 */
export function startSyncSchedule(run: () => Promise<unknown> = runSync): void {
  let busy = false;
  const go = async () => {
    busy = true;
    try {
      await run();
    } finally {
      busy = false;
    }
  };

  void browser.alarms.create(PERIODIC, { periodInMinutes: 15 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === PERIODIC || alarm.name === SOON) void go();
  });
  void go();

  liveQuery(latestChange).subscribe({ next: (latest) => !busy && void armSoon(latest), error: () => {} });
}
