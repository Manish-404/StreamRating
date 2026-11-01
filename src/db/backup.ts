import type { Table } from 'dexie';
import { sameRecords, supersedes } from '../sync/merge';
import { db } from './schema';
import type { Syncable } from './types';

/** The tables that hold the user's own data. The ratings cache is left out: it refills itself. Settings and API keys are never exported. */
const TABLES = ['history', 'watchlist', 'reactions', 'matchOverrides'] as const;
type TableName = (typeof TABLES)[number];

export const BACKUP_APP = 'streamrating';
export const BACKUP_VERSION = 1;

export interface Backup {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: number;
  tables: Record<TableName, Syncable[]>;
}

export async function exportBackup(now = Date.now()): Promise<Backup> {
  const [history, watchlist, reactions, matchOverrides] = await Promise.all([
    db.history.toArray(),
    db.watchlist.toArray(),
    db.reactions.toArray(),
    db.matchOverrides.toArray(),
  ]);
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now, tables: { history, watchlist, reactions, matchOverrides } };
}

export const backupFileName = (now = Date.now()) => 'streamrating-backup-' + new Date(now).toISOString().slice(0, 10) + '.json';

const isRecord = (r: unknown): r is Syncable =>
  !!r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string' && (r as { id: string }).id !== '' && Number.isFinite((r as { updatedAt?: unknown }).updatedAt);

/** Reads a backup file's text. Throws a message fit for the user when the file is not one of ours. */
export function parseBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not a StreamRating backup (it is not valid JSON).');
  }
  const b = data as Partial<Backup> | null;
  if (!b || b.app !== BACKUP_APP || typeof b.tables !== 'object' || !b.tables) throw new Error('That file is not a StreamRating backup.');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) throw new Error('That backup comes from a newer version of StreamRating. Update the extension first.');
  const tables = {} as Backup['tables'];
  for (const t of TABLES) {
    const rows: unknown = (b.tables as Record<string, unknown>)[t] ?? [];
    if (!Array.isArray(rows)) throw new Error('That backup is damaged: "' + t + '" is not a list.');
    tables[t] = rows.filter(isRecord);
  }
  return { app: BACKUP_APP, version: b.version, exportedAt: Number(b.exportedAt) || 0, tables };
}

export interface ImportResult {
  /** Records that were new here or newer than the local copy. */
  added: number;
  updated: number;
  /** Records where this device already had the same or a newer version. */
  kept: number;
}

/**
 * Merges a backup into the database record by record: the copy with the later `updatedAt` wins, so importing never
 * overwrites something newer made here, and a delete (tombstone) made later than the other side's edit wins too.
 */
export async function importBackup(backup: Backup): Promise<ImportResult> {
  const result: ImportResult = { added: 0, updated: 0, kept: 0 };
  await db.transaction('rw', TABLES.map((t) => db[t]), async () => {
    for (const t of TABLES) {
      const table = db[t] as unknown as Table<Syncable, string>;
      const local = new Map((await table.bulkGet(backup.tables[t].map((r) => r.id))).map((r, i) => [backup.tables[t][i]!.id, r]));
      const take = backup.tables[t].filter((r) => {
        const mine = local.get(r.id);
        if (!mine) result.added++;
        else if (supersedes(r, mine)) result.updated++;
        else {
          result.kept++;
          return false;
        }
        return true;
      });
      await table.bulkPut(take);
    }
  });
  return result;
}

/** Do two backups hold the same records in the same state? Decides whether a sync has anything to write. */
export const sameData = (a: Backup, b: Backup) => TABLES.every((t) => sameRecords(a.tables[t], b.tables[t]));
