export type MediaType = 'movie' | 'tv';
export type Platform = 'netflix' | 'hotstar' | 'zee5' | 'youtube' | 'stremio' | 'torrent' | 'manual';

/** Fields every record that is saved to Drive / the local folder carries so devices can merge. */
export interface Syncable {
  id: string;
  /** Epoch ms of the last change; the newest change wins when two devices disagree. */
  updatedAt: number;
  /** Tombstone: a deleted record is kept so the delete also reaches the other devices. */
  deleted?: boolean;
}

export interface TitleRef {
  imdbId: string;
  tmdbId?: number;
  type: MediaType;
  title: string;
  year?: number;
}

export interface HistoryEntry extends Syncable, TitleRef {
  season?: number;
  episode?: number;
  platform: Platform;
  /** 0..1 of the runtime that was played. */
  progress: number;
  watchedAt: number;
  source: 'auto' | 'manual';
  /** 'interest' = a trailer view or a magnet click, a weak signal that does not count as watched. */
  kind: 'watch' | 'interest';
}

export interface WatchlistEntry extends Syncable, TitleRef {
  addedAt: number;
}

export interface Reaction extends Syncable {
  imdbId: string;
  /** 1 = liked, -1 = disliked, 0 = cleared. */
  value: 1 | -1 | 0;
}

/** The user's correction of a wrong title match; `id` is the lookup key it applies to. */
export interface MatchOverride extends Syncable {
  imdbId: string;
  tmdbId: number;
  type: MediaType;
}

/** A cached API result. Caches are never synced; they are rebuilt on demand. */
export interface CacheRow {
  key: string;
  fetchedAt: number;
  data: unknown;
}
