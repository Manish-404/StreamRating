import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MissingKeyError, QuotaExceededError } from '../src/api/errors';
import type { OmdbTitle } from '../src/api/omdb';
import type { TmdbDetails, TmdbSearchHit } from '../src/api/tmdb';
import { db } from '../src/db/schema';
import { scoreCandidate } from '../src/match/resolve';
import { createLookup, matchKey } from '../src/services/lookup';

const hit = (o: Partial<TmdbSearchHit>): TmdbSearchHit => ({
  id: 1, media_type: 'tv', name: 'Dark', first_air_date: '2017-12-01', popularity: 50,
  vote_average: 8, vote_count: 100, poster_path: null, overview: '', original_language: 'de', genre_ids: [], ...o,
});

const details: TmdbDetails = {
  id: 70523, name: 'Dark', overview: 'A missing child.', tagline: '', first_air_date: '2017-12-01',
  episode_run_time: [60], number_of_seasons: 3, genres: [{ id: 1, name: 'Drama' }, { id: 2, name: 'Sci-Fi' }],
  poster_path: '/p.jpg', backdrop_path: null, vote_average: 8.4, vote_count: 5000, original_language: 'de',
  external_ids: { imdb_id: 'tt5753856' },
  credits: { cast: [{ id: 2, name: 'B', order: 1 }, { id: 1, name: 'A', order: 0 }], crew: [] },
  created_by: [{ id: 9, name: 'Baran bo Odar' }],
};

const ratings: OmdbTitle = {
  imdbId: 'tt5753856', title: 'Dark', year: '2017-2020', type: 'series', imdbRating: 8.7, imdbVotes: 400000,
  rtCritics: 95, metacritic: null, plot: null, genre: null, runtimeMin: 60, rated: null, awards: null, poster: null, totalSeasons: 3,
};

function deps(over: { search?: TmdbSearchHit[]; omdb?: () => Promise<OmdbTitle | null> } = {}) {
  return {
    tmdb: {
      searchMulti: vi.fn(async (..._a: unknown[]) => over.search ?? [hit({ id: 70523 })]),
      findByImdbId: vi.fn(async (..._a: unknown[]) => ({ movie_results: [], tv_results: [hit({ id: 70523 })] })),
      getDetails: vi.fn(async (..._a: unknown[]) => details),
    },
    omdb: { getByImdbId: vi.fn(over.omdb ?? (async (..._a: unknown[]) => ratings)) },
  };
}

beforeEach(async () => {
  await Promise.all([db.cache.clear(), db.matchOverrides.clear()]);
});

describe('scoreCandidate', () => {
  it('prefers the right year among same-named titles', () => {
    const q = { title: 'The Office', year: 2005 };
    const us = hit({ name: 'The Office', first_air_date: '2005-03-24' });
    const uk = hit({ name: 'The Office', first_air_date: '2001-07-09' });
    expect(scoreCandidate(q, us)).toBeGreaterThan(scoreCandidate(q, uk));
  });

  it('penalises the wrong type and a different title', () => {
    const q = { title: 'Dark', type: 'tv' as const };
    expect(scoreCandidate(q, hit({}))).toBeGreaterThan(scoreCandidate(q, hit({ media_type: 'movie', title: 'Dark', name: undefined })));
    expect(scoreCandidate(q, hit({ name: 'Completely Different' }))).toBeLessThan(0.6);
  });

  it('clears the match threshold for an exact title with nothing else known', () => {
    expect(scoreCandidate({ title: 'Dark' }, hit({}))).toBeGreaterThan(0.75);
  });
});

describe('lookup', () => {
  it('finds a title and combines TMDB details with OMDb ratings', async () => {
    const result = await createLookup(deps())({ title: 'Dark' });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.info).toMatchObject({
      imdbId: 'tt5753856', title: 'Dark', year: 2017, genres: ['Drama', 'Sci-Fi'], cast: ['A', 'B'],
      directors: ['Baran bo Odar'], runtimeMin: 60, imdbRating: 8.7, rtCritics: 95, ratingsStatus: 'ok',
    });
  });

  it('serves a repeat lookup from the cache without calling any API', async () => {
    const d = deps();
    const lookup = createLookup(d);
    await lookup({ title: 'Dark' });
    await lookup({ title: 'Dark' });
    expect(d.tmdb.searchMulti).toHaveBeenCalledTimes(1);
    expect(d.tmdb.getDetails).toHaveBeenCalledTimes(1);
    expect(d.omdb.getByImdbId).toHaveBeenCalledTimes(1);
  });

  it('uses the exact IMDb id when the page has one', async () => {
    const d = deps();
    await createLookup(d)({ title: 'whatever', imdbId: 'tt5753856' });
    expect(d.tmdb.findByImdbId).toHaveBeenCalledWith('tt5753856');
    expect(d.tmdb.searchMulti).not.toHaveBeenCalled();
  });

  it('honours a correction the user made', async () => {
    const d = deps();
    await db.matchOverrides.put({ id: 'netflix:80057281', updatedAt: 1, imdbId: 'tt5753856', tmdbId: 777, type: 'tv' });
    await createLookup(d)({ title: 'Dark', platform: 'netflix', platformId: '80057281' });
    expect(d.tmdb.getDetails).toHaveBeenCalledWith('tv', 777);
    expect(d.tmdb.searchMulti).not.toHaveBeenCalled();
  });

  it('reports not_found when nothing is close, and remembers it', async () => {
    const d = deps({ search: [hit({ name: 'Zzzzzz Qqqq' })] });
    const lookup = createLookup(d);
    expect((await lookup({ title: 'Dark' })).status).toBe('not_found');
    await lookup({ title: 'Dark' });
    expect(d.tmdb.searchMulti).toHaveBeenCalledTimes(1);
  });

  it('still returns the title when the OMDb key is missing or its quota is used', async () => {
    const noKey = await createLookup(deps({ omdb: async () => Promise.reject(new MissingKeyError('omdb')) }))({ title: 'Dark' });
    expect(noKey.status === 'ok' && noKey.info.ratingsStatus).toBe('missing_key');
    await db.cache.clear();
    const noQuota = await createLookup(deps({ omdb: async () => Promise.reject(new QuotaExceededError('omdb')) }))({ title: 'Dark' });
    expect(noQuota.status === 'ok' && noQuota.info.ratingsStatus).toBe('quota');
    expect(noQuota.status === 'ok' && noQuota.info.tmdbRating).toBe(8.4);
  });

  it('turns a missing TMDB key into an error result', async () => {
    const d = deps();
    d.tmdb.searchMulti.mockRejectedValueOnce(new MissingKeyError('tmdb'));
    expect(await createLookup(d)({ title: 'Dark' })).toMatchObject({ status: 'error', kind: 'missing_key' });
  });

  it('builds the cache key from the normalised title, year and type', () => {
    expect(matchKey({ title: 'Dark!', year: 2017, type: 'tv' })).toBe('dark|2017|tv');
    expect(matchKey({ title: 'x', imdbId: 'tt1' })).toBe('imdb:tt1');
  });
});
