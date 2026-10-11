import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MissingKeyError, QuotaExceededError } from '../src/api/errors';
import type { OmdbSeason } from '../src/api/omdb';
import { db } from '../src/db/schema';
import { createSeasons } from '../src/services/seasons';

const season: OmdbSeason = { season: 1, totalSeasons: 3, episodes: [{ episode: 1, title: 'Pilot', released: null, imdbRating: 8.3, imdbId: 'tt1' }] };

beforeEach(async () => {
  await db.cache.clear();
});

describe('createSeasons', () => {
  it('returns the season and serves a repeat from the cache', async () => {
    const getSeason = vi.fn(async (..._a: unknown[]) => season);
    const get = createSeasons({ omdb: { getSeason } });
    expect(await get('tt0903747', 1)).toEqual({ status: 'ok', season });
    await get('tt0903747', 1);
    expect(getSeason).toHaveBeenCalledTimes(1);
    await get('tt0903747', 2);
    expect(getSeason).toHaveBeenCalledTimes(2);
  });

  it('reports not_found, quota and missing key without throwing', async () => {
    expect(await createSeasons({ omdb: { getSeason: async () => null } })('tt1', 9)).toEqual({ status: 'not_found' });
    expect(await createSeasons({ omdb: { getSeason: async () => Promise.reject(new QuotaExceededError('omdb')) } })('tt2', 1)).toEqual({ status: 'quota' });
    expect(await createSeasons({ omdb: { getSeason: async () => Promise.reject(new MissingKeyError('omdb')) } })('tt3', 1)).toEqual({ status: 'missing_key' });
    expect(await createSeasons({ omdb: { getSeason: async () => Promise.reject(new Error('boom')) } })('tt4', 1)).toEqual({ status: 'error' });
  });
});
