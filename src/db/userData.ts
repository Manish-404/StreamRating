import { db } from './schema';
import type { HistoryEntry, MediaType, Platform, TitleRef, WatchlistEntry } from './types';

/** What a page tells the background about the title it means: enough to name it in a list and to find it again. */
export interface TitleKey {
  imdbId: string | null;
  tmdbId: number;
  type: MediaType;
  title: string;
  year?: number;
}

/** One title's id in every list. The IMDb id when TMDB has one, else the TMDB id, so a title without an IMDb entry still counts. */
export const titleId = (t: Pick<TitleKey, 'imdbId' | 'type' | 'tmdbId'>) => t.imdbId || t.type + ':' + t.tmdbId;

/** A film is one entry; a series gets one per episode, so the log says which episodes were seen. */
export const historyId = (t: Pick<TitleKey, 'imdbId' | 'type' | 'tmdbId'>, season?: number, episode?: number) =>
  titleId(t) + (season !== undefined && episode !== undefined ? ':s' + season + 'e' + episode : '');

const refOf = (t: TitleKey): TitleRef => ({
  imdbId: t.imdbId ?? '',
  tmdbId: t.tmdbId,
  type: t.type,
  title: t.title,
  ...(t.year !== undefined ? { year: t.year } : {}),
});

/** All of a title's history entries: the title-level one (a film, a series marked watched) and its episodes. */
async function entriesOf(t: TitleKey): Promise<HistoryEntry[]> {
  const id = titleId(t);
  const [own, episodes] = await Promise.all([
    db.history.get(id),
    db.history.where('id').between(id + ':', id + ':￿').toArray(),
  ]);
  return [...(own ? [own] : []), ...episodes].filter((e) => !e.deleted);
}

export interface PlayedInput {
  title: TitleKey;
  platform: Platform;
  season?: number;
  episode?: number;
  /** 0..1 of the runtime that was reached. */
  progress: number;
  /** A trailer view: a weak signal that is listed apart from what was watched. */
  trailer?: boolean;
}

/**
 * Logs that something was played. Called again as playback goes on, it moves the same entry forward: the time of the
 * last watch is kept, and the progress never goes backwards. A trailer never replaces a real watch of the same title.
 */
export async function recordPlayed(input: PlayedInput, now = Date.now()): Promise<HistoryEntry> {
  const id = historyId(input.title, input.season, input.episode);
  const kind: HistoryEntry['kind'] = input.trailer ? 'interest' : 'watch';
  const existing = await db.history.get(id);
  if (existing && !existing.deleted && existing.kind === 'watch' && kind === 'interest') return existing;
  const progress = Math.min(1, Math.max(0, input.progress));
  const keepProgress = existing && !existing.deleted && existing.kind === kind ? existing.progress : 0;
  const entry: HistoryEntry = {
    ...refOf(input.title),
    id,
    ...(input.season !== undefined && input.episode !== undefined ? { season: input.season, episode: input.episode } : {}),
    platform: input.platform,
    progress: Math.max(progress, keepProgress),
    watchedAt: now,
    source: 'auto',
    kind,
    updatedAt: now,
  };
  await db.history.put(entry);
  return entry;
}

/** What the hover card shows and lets the user change. */
export interface TitleState {
  watchlisted: boolean;
  /** Not seen, seen, or seen in episodes (shown, but only the History tab removes those). */
  watched: 'no' | 'yes' | 'episodes';
  episodes: number;
}

export async function getTitleState(t: TitleKey): Promise<TitleState> {
  const [entries, saved] = await Promise.all([entriesOf(t), db.watchlist.get(titleId(t))]);
  const watched = entries.filter((e) => e.kind === 'watch');
  const episodes = watched.filter((e) => e.episode !== undefined).length;
  return {
    watchlisted: !!saved && !saved.deleted,
    watched: watched.length === 0 ? 'no' : t.type === 'tv' && episodes > 0 ? 'episodes' : 'yes',
    episodes,
  };
}

/**
 * The "Watched" button on the card. On: a manual entry for the whole title. Off: removes the title's entry, but only
 * where that is the one thing the button added (a film, or a series marked as a whole); played episodes stay.
 */
export async function setWatched(t: TitleKey, platform: Platform, watched: boolean, now = Date.now()): Promise<TitleState> {
  const id = titleId(t);
  if (watched) {
    const existing = await db.history.get(id);
    if (!existing || existing.deleted || existing.kind !== 'watch') {
      await db.history.put({ ...refOf(t), id, platform, progress: 1, watchedAt: now, source: 'manual', kind: 'watch', updatedAt: now });
    }
  } else {
    const own = await db.history.get(id);
    if (own && !own.deleted) await db.history.put({ ...own, deleted: true, updatedAt: now });
  }
  return getTitleState(t);
}

export async function setWatchlisted(t: TitleKey, on: boolean, now = Date.now()): Promise<TitleState> {
  const id = titleId(t);
  const existing = await db.watchlist.get(id);
  if (on) {
    const entry: WatchlistEntry = { ...refOf(t), id, addedAt: existing && !existing.deleted ? existing.addedAt : now, updatedAt: now };
    await db.watchlist.put(entry);
  } else if (existing && !existing.deleted) {
    await db.watchlist.put({ ...existing, deleted: true, updatedAt: now });
  }
  return getTitleState(t);
}

/** Deleted entries are kept as tombstones so the delete reaches other devices; they are never listed. */
export async function listHistory(): Promise<HistoryEntry[]> {
  return (await db.history.orderBy('watchedAt').reverse().toArray()).filter((e) => !e.deleted);
}

export async function listWatchlist(): Promise<WatchlistEntry[]> {
  return (await db.watchlist.toArray()).filter((e) => !e.deleted).sort((a, b) => b.addedAt - a.addedAt);
}

export async function deleteHistoryEntry(id: string, now = Date.now()): Promise<void> {
  const e = await db.history.get(id);
  if (e && !e.deleted) await db.history.put({ ...e, deleted: true, updatedAt: now });
}

export async function removeFromWatchlist(id: string, now = Date.now()): Promise<void> {
  const e = await db.watchlist.get(id);
  if (e && !e.deleted) await db.watchlist.put({ ...e, deleted: true, updatedAt: now });
}

export async function countUserData(): Promise<{ watched: number; trailers: number; watchlist: number }> {
  const [history, watchlist] = await Promise.all([listHistory(), listWatchlist()]);
  // A series counts once however many of its episodes were seen.
  const titles = new Set(history.filter((e) => e.kind === 'watch').map((e) => e.imdbId || e.type + ':' + e.tmdbId));
  return { watched: titles.size, trailers: history.filter((e) => e.kind === 'interest').length, watchlist: watchlist.length };
}
