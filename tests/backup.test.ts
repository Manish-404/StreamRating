import { beforeEach, describe, expect, it } from 'vitest';
import { exportBackup, importBackup, parseBackup } from '../src/db/backup';
import { db } from '../src/db/schema';
import { listHistory, listWatchlist, recordPlayed, removeFromWatchlist, setWatchlisted, type TitleKey } from '../src/db/userData';

const film: TitleKey = { imdbId: 'tt15398776', tmdbId: 872585, type: 'movie', title: 'Oppenheimer', year: 2023 };
const other: TitleKey = { imdbId: 'tt1375666', tmdbId: 27205, type: 'movie', title: 'Inception', year: 2010 };

beforeEach(async () => {
  await Promise.all([db.history.clear(), db.watchlist.clear(), db.reactions.clear(), db.matchOverrides.clear(), db.cache.clear()]);
});

/** Export, wipe, and bring the text back as the user would: through a file. */
const roundTrip = async () => {
  const text = JSON.stringify(await exportBackup());
  await Promise.all([db.history.clear(), db.watchlist.clear()]);
  return importBackup(parseBackup(text));
};

describe('backup', () => {
  it('brings the watchlist and history back after the data was lost', async () => {
    await setWatchlisted(film, true, 1000);
    await recordPlayed({ title: other, platform: 'netflix', progress: 0.4 }, 2000);
    const r = await roundTrip();
    expect(r).toEqual({ added: 2, updated: 0, kept: 0 });
    expect((await listWatchlist()).map((e) => e.title)).toEqual(['Oppenheimer']);
    expect((await listHistory()).map((e) => e.title)).toEqual(['Inception']);
  });

  it('keeps removals: a removed title stays removed after import', async () => {
    await setWatchlisted(film, true, 1000);
    await removeFromWatchlist('tt15398776', 2000);
    await roundTrip();
    expect(await listWatchlist()).toEqual([]);
  });

  it('never overwrites something newer made on this device', async () => {
    await setWatchlisted(film, true, 1000);
    const text = JSON.stringify(await exportBackup());
    await removeFromWatchlist('tt15398776', 5000); // removed here after the backup was made
    const r = await importBackup(parseBackup(text));
    expect(r.kept).toBe(1);
    expect(await listWatchlist()).toEqual([]);
  });

  it('takes a newer version from the backup', async () => {
    await setWatchlisted(film, true, 1000);
    await removeFromWatchlist('tt15398776', 5000);
    const text = JSON.stringify(await exportBackup());
    await setWatchlisted(film, true, 2000); // older than the removal in the backup
    const r = await importBackup(parseBackup(text));
    expect(r.updated).toBe(1);
    expect(await listWatchlist()).toEqual([]);
  });

  it('is harmless to import twice', async () => {
    await setWatchlisted(film, true, 1000);
    const text = JSON.stringify(await exportBackup());
    await importBackup(parseBackup(text));
    expect(await importBackup(parseBackup(text))).toEqual({ added: 0, updated: 0, kept: 1 });
    expect(await db.watchlist.count()).toBe(1);
  });

  it('leaves the ratings cache out', async () => {
    await db.cache.put({ key: 'k', value: 1, fetchedAt: 1 } as never);
    const b = await exportBackup();
    expect(Object.keys(b.tables).sort()).toEqual(['history', 'matchOverrides', 'reactions', 'watchlist']);
  });

  it('refuses files that are not a backup, with a plain message', () => {
    expect(() => parseBackup('not json')).toThrow(/not valid JSON/);
    expect(() => parseBackup('{"hello":1}')).toThrow(/not a StreamRating backup/);
    expect(() => parseBackup('{"app":"streamrating","version":99,"tables":{}}')).toThrow(/newer version/);
    expect(() => parseBackup('{"app":"streamrating","version":1,"tables":{"history":5}}')).toThrow(/damaged/);
  });

  it('skips malformed records instead of writing them', async () => {
    const b = parseBackup(JSON.stringify({ app: 'streamrating', version: 1, tables: { watchlist: [{ id: 'a', updatedAt: 1 }, { id: 3 }, null, { updatedAt: 2 }] } }));
    expect(b.tables.watchlist).toHaveLength(1);
    await importBackup(b);
    expect(await db.watchlist.count()).toBe(1);
  });
});
