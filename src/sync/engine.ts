import { exportBackup, importBackup, parseBackup, sameData } from '../db/backup';
import type { SyncTarget } from './drive';

export interface SyncReport {
  /** Records this device took from the file. */
  pulled: number;
  /** Whether the file was rewritten because this device had something it lacked. */
  pushed: boolean;
}

/**
 * One round: read the file, merge it into the local database (the newer copy of each record wins), and write the
 * merged result back if the file lacked anything. A file we cannot read stops the round instead of being overwritten.
 */
export async function syncOnce(target: SyncTarget, now = Date.now()): Promise<SyncReport> {
  const text = await target.read();
  const remote = text === null ? null : parseBackup(text);
  const imported = remote ? await importBackup(remote) : { added: 0, updated: 0, kept: 0 };
  const merged = await exportBackup(now);
  const pushed = !remote || !sameData(remote, merged);
  if (pushed) await target.write(JSON.stringify(merged));
  return { pulled: imported.added + imported.updated, pushed };
}
