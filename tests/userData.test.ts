import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/schema';
import {
  countUserData,
  deleteHistoryEntry,
  getTitleState,
  historyId,
  listHistory,
  listWatchlist,
  recordPlayed,
  removeFromWatchlist,
  setWatched,
  setWatchlisted,
  titleId,
  type TitleKey,
} from '../src/db/userData';

const film: TitleKey = { imdbId: 'tt15398776', tmdbId: 872585, type: 'movie', title: 'Oppenheimer', year: 2023 };
const show: TitleKey = { imdbId: 'tt4574334', tmdbId: 66732, type: 'tv', title: 'Stranger Things', year: 2016 };

beforeEach(async () => {
  await Promise.all([db.history.clear(), db.watchlist.clear()]);
});

describe('history', () => {
  it('logs a film once and moves its progress forward, never back', async () => {
    await recordPlayed({ title: film, platform: 'netflix', progress: 0.2 }, 1000);
    await recordPlayed({ title: film, platform: 'netflix', progress: 0.6 }, 2000);
    await recordPlayed({ title: film, platform: 'netflix', progress: 0.3 }, 3000);
    const list = await listHistory();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'tt15398776', imdbId: 'tt15398776', platform: 'netflix', progress: 0.6, source: 'auto', kind: 'watch', watchedAt: 3000 });
  });

  it('keeps one entry per episode of a series', async () => {
    await recordPlayed({ title: show, platform: 'netflix', season: 1, episode: 1, progress: 1 });
    await recordPlayed({ title: show, platform: 'netflix', season: 1, episode: 2, progress: 0.4 });
    await recordPlayed({ title: show, platform: 'netflix', season: 1, episode: 1, progress: 1 });
    const list = await listHistory();
    expect(list.map((e) => e.id).sort()).toEqual(['tt4574334:s1e1', 'tt4574334:s1e2']);
    expect(list.every((e) => e.type === 'tv' && e.title === 'Stranger Things')).toBe(true);
  });

  it('lists the newest watch first', async () => {
    await recordPlayed({ title: film, platform: 'youtube', progress: 0.5 }, 1000);
    await recordPlayed({ title: show, platform: 'netflix', season: 1, episode: 1, progress: 0.5 }, 5000);
    expect((await listHistory()).map((e) => e.title)).toEqual(['Stranger Things', 'Oppenheimer']);
  });

  it('keeps a trailer view apart from a watch, and a trailer never replaces a watch', async () => {
    await recordPlayed({ title: film, platform: 'youtube', progress: 0.9, trailer: true }, 1000);
    expect((await listHistory())[0]).toMatchObject({ kind: 'interest' });
    expect((await getTitleState(film)).watched).toBe('no'); // a trailer is not watching the film
    await recordPlayed({ title: film, platform: 'netflix', progress: 0.5 }, 2000);
    await recordPlayed({ title: film, platform: 'youtube', progress: 1, trailer: true }, 3000);
    expect((await listHistory())[0]).toMatchObject({ kind: 'watch', platform: 'netflix', progress: 0.5 });
  });

  it('deleting hides an entry but keeps a tombstone for the other devices', async () => {
    await recordPlayed({ title: film, platform: 'netflix', progress: 0.5 }, 1000);
    await deleteHistoryEntry('tt15398776', 2000);
    expect(await listHistory()).toEqual([]);
    expect(await db.history.get('tt15398776')).toMatchObject({ deleted: true, updatedAt: 2000 });
    // Watching it again brings it back.
    await recordPlayed({ title: film, platform: 'netflix', progress: 0.1 }, 3000);
    expect(await listHistory()).toHaveLength(1);
  });

  it('names a title without an IMDb entry by its TMDB id', async () => {
    const obscure: TitleKey = { imdbId: null, tmdbId: 99, type: 'movie', title: 'Obscure' };
    expect(titleId(obscure)).toBe('movie:99');
    expect(historyId({ ...obscure, type: 'tv' }, 2, 5)).toBe('tv:99:s2e5');
    await recordPlayed({ title: obscure, platform: 'youtube', progress: 0.5 });
    expect((await listHistory())[0]).toMatchObject({ id: 'movie:99', imdbId: '', tmdbId: 99 });
  });
});

describe('the card buttons', () => {
  it('Watched adds a manual entry and a second press removes it', async () => {
    expect((await setWatched(film, 'netflix', true, 1000)).watched).toBe('yes');
    expect((await listHistory())[0]).toMatchObject({ source: 'manual', platform: 'netflix', progress: 1 });
    expect((await setWatched(film, 'netflix', false, 2000)).watched).toBe('no');
    expect(await listHistory()).toEqual([]);
  });

  it('pressing Watched on a film that was played keeps the played entry', async () => {
    await recordPlayed({ title: film, platform: 'youtube', progress: 0.4 }, 1000);
    await setWatched(film, 'youtube', true, 2000);
    expect((await listHistory())[0]).toMatchObject({ source: 'auto', progress: 0.4 });
  });

  it('a series with played episodes shows them and cannot be wiped from the card', async () => {
    await recordPlayed({ title: show, platform: 'netflix', season: 1, episode: 1, progress: 1 });
    await recordPlayed({ title: show, platform: 'netflix', season: 1, episode: 2, progress: 1 });
    expect(await getTitleState(show)).toEqual({ watchlisted: false, watched: 'episodes', episodes: 2 });
    await setWatched(show, 'netflix', false);
    expect(await listHistory()).toHaveLength(2);
  });

  it('a series marked watched as a whole can be unmarked', async () => {
    expect((await setWatched(show, 'netflix', true)).watched).toBe('yes');
    expect((await setWatched(show, 'netflix', false)).watched).toBe('no');
  });

  it('a series id does not collide with another title that starts the same way', async () => {
    const other: TitleKey = { ...show, imdbId: 'tt45743340', tmdbId: 1, title: 'Another' };
    await recordPlayed({ title: other, platform: 'netflix', season: 1, episode: 1, progress: 1 });
    expect((await getTitleState(show)).watched).toBe('no');
  });

  it('Watchlist saves, removes and saves again', async () => {
    expect((await setWatchlisted(film, true, 1000)).watchlisted).toBe(true);
    expect(await listWatchlist()).toHaveLength(1);
    expect((await setWatchlisted(film, false, 2000)).watchlisted).toBe(false);
    expect(await listWatchlist()).toEqual([]);
    await setWatchlisted(film, true, 3000);
    expect((await listWatchlist())[0]).toMatchObject({ id: 'tt15398776', title: 'Oppenheimer', addedAt: 3000 });
  });

  it('pressing Watchlist twice in a row keeps the first save date', async () => {
    await setWatchlisted(film, true, 1000);
    await setWatchlisted(film, true, 2000);
    expect((await listWatchlist())[0]?.addedAt).toBe(1000);
  });

  it('lists the newest saved first and removes from the dashboard', async () => {
    await setWatchlisted(film, true, 1000);
    await setWatchlisted(show, true, 2000);
    expect((await listWatchlist()).map((e) => e.title)).toEqual(['Stranger Things', 'Oppenheimer']);
    await removeFromWatchlist('tt4574334', 3000);
    expect((await listWatchlist()).map((e) => e.title)).toEqual(['Oppenheimer']);
  });
});

describe('counts', () => {
  it('counts a series once however many episodes were seen, and keeps trailers apart', async () => {
    await recordPlayed({ title: show, platform: 'netflix', season: 1, episode: 1, progress: 1 });
    await recordPlayed({ title: show, platform: 'netflix', season: 1, episode: 2, progress: 1 });
    await recordPlayed({ title: film, platform: 'youtube', progress: 1, trailer: true });
    await setWatchlisted(film, true);
    expect(await countUserData()).toEqual({ watched: 1, trailers: 1, watchlist: 1 });
  });
});
