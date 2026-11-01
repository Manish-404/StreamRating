import type { Syncable } from '../db/types';

/**
 * Whether `incoming` should replace `current`. The newer change wins; on a tie a delete wins, so a removal made at
 * the same instant as an edit is not undone. Every place that combines two copies (import, Drive) uses this one rule,
 * which is what makes the devices agree.
 */
export function supersedes(incoming: Syncable, current: Syncable | undefined): boolean {
  if (!current) return true;
  if (incoming.updatedAt !== current.updatedAt) return incoming.updatedAt > current.updatedAt;
  return !!incoming.deleted && !current.deleted;
}

/** The same records in the same state on both sides? Compared by id, time and delete mark, not by content. */
export function sameRecords(a: Syncable[], b: Syncable[]): boolean {
  if (a.length !== b.length) return false;
  const key = (r: Syncable) => r.id + '@' + r.updatedAt + (r.deleted ? 'x' : '');
  const seen = new Set(a.map(key));
  return b.every((r) => seen.has(key(r)));
}
