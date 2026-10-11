import Dexie, { type Table } from 'dexie';
import type { CacheRow, HistoryEntry, MatchOverride, Reaction, WatchlistEntry } from './types';

export class StreamRatingDB extends Dexie {
  cache!: Table<CacheRow, string>;
  history!: Table<HistoryEntry, string>;
  watchlist!: Table<WatchlistEntry, string>;
  reactions!: Table<Reaction, string>;
  matchOverrides!: Table<MatchOverride, string>;

  constructor(name = 'streamrating') {
    super(name);
    this.version(1).stores({
      cache: 'key, fetchedAt',
      history: 'id, imdbId, platform, watchedAt, updatedAt',
      watchlist: 'id, imdbId, updatedAt',
      reactions: 'id, imdbId, updatedAt',
      matchOverrides: 'id, updatedAt',
    });
  }
}

export const db = new StreamRatingDB();
