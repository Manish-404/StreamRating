import { storage } from 'wxt/utils/storage';
import { getSettings } from '../settings';
import { createDriveTarget, type SyncTarget } from './drive';
import { syncOnce } from './engine';
import { forgetToken, getAccessToken, NeedsReconnect } from './googleAuth';

/** What the Data tab shows. Saved so it is still there after the background sleeps. */
export interface SyncStatus {
  /** The user pressed Connect and has not disconnected. */
  connected: boolean;
  lastOkAt?: number;
  lastError?: string;
  /** Google wants a fresh sign-in: the Connect button is shown again. */
  needsReconnect?: boolean;
  /** Everything changed before this moment (ms) was in the file after the last good round. Newer records still need syncing. */
  syncedUpTo?: number;
  pulled?: number;
  pushed?: boolean;
}

const statusItem = storage.defineItem<SyncStatus>('local:syncStatus', { fallback: { connected: false } });

export const getSyncStatus = () => statusItem.getValue();
export const watchSyncStatus = (cb: (s: SyncStatus) => void) => statusItem.watch((s) => cb(s ?? { connected: false }));

export interface SyncDeps {
  clientId: () => Promise<string>;
  target: (clientId: string) => SyncTarget;
  now: () => number;
}

const defaultDeps: SyncDeps = {
  clientId: async () => (await getSettings()).googleClientId,
  target: (clientId) => createDriveTarget(() => getAccessToken(clientId, false)),
  now: Date.now,
};

let running: Promise<SyncStatus> | null = null;

/** Syncs now if Drive is connected. Calls that arrive while a round is running share it. Never throws: the outcome is the status. */
export function runSync(deps: SyncDeps = defaultDeps): Promise<SyncStatus> {
  return (running ??= round(deps).finally(() => (running = null)));
}

async function round(deps: SyncDeps): Promise<SyncStatus> {
  const before = await statusItem.getValue();
  if (!before.connected) return before;
  const save = async (patch: Partial<SyncStatus>) => {
    const next = { ...(await statusItem.getValue()), ...patch };
    await statusItem.setValue(next);
    return next;
  };
  const startedAt = deps.now();
  try {
    const clientId = await deps.clientId();
    if (!clientId.trim()) return await save({ needsReconnect: true, lastError: 'The Google client ID is missing.' });
    const report = await syncOnce(deps.target(clientId), deps.now());
    return await save({ lastOkAt: deps.now(), lastError: undefined, needsReconnect: false, syncedUpTo: startedAt, pulled: report.pulled, pushed: report.pushed });
  } catch (e) {
    if (e instanceof NeedsReconnect) {
      await forgetToken();
      return await save({ needsReconnect: true, lastError: e.message });
    }
    return await save({ lastError: e instanceof Error ? e.message : String(e) });
  }
}

/** The Connect button: opens Google's sign-in window, then syncs. Runs on the options page (a window is needed). */
export async function connectDrive(clientId: string): Promise<SyncStatus> {
  await getAccessToken(clientId, true);
  await statusItem.setValue({ connected: true });
  return runSync();
}

export async function disconnectDrive(): Promise<void> {
  await forgetToken();
  await statusItem.setValue({ connected: false });
}
