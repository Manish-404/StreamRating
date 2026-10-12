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

  it('treats a name that differs only in spacing and dots as the same name', () => {
    const kgf = hit({ media_type: 'movie', name: undefined, title: 'K.G.F: Chapter 2', first_air_date: undefined, release_date: '2022-04-14' });
    expect(scoreCandidate({ title: 'KGF Chapter 2', type: 'movie' }, kgf)).toBeGreaterThan(0.85);
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

  it('tries each reading of a name, and stops at the first exact one', async () => {
    const scary = hit({ id: 10, media_type: 'movie', name: undefined, title: 'Scary Movie', first_air_date: undefined, release_date: '2000-07-07', popularity: 40 });
    const d = deps();
    d.tmdb.searchMulti.mockImplementation(async (q: unknown) => (q === 'Scary Movie' ? [scary] : [hit({ id: 11, media_type: 'movie', name: undefined, title: 'Scary', first_air_date: undefined })]));
    const result = await createLookup(d)({ title: 'Scary Movie', alternatives: ['Scary'], type: 'movie' });
    expect(result.status).toBe('ok');
    expect(d.tmdb.searchMulti.mock.calls.map((c) => c[0])).toEqual(['Scary Movie']);
    expect(d.tmdb.getDetails).toHaveBeenCalledWith('movie', 10);
  });

  it('falls through to a later reading when the first finds nothing close', async () => {
    const uri = hit({ id: 20, media_type: 'movie', name: undefined, title: 'Uri: The Surgical Strike', first_air_date: undefined });
    const d = deps();
    d.tmdb.searchMulti.mockImplementation(async (q: unknown) => (q === 'Uri' ? [uri] : []));
    await createLookup(d)({ title: 'Uri The Surgical Strike Hindi', alternatives: ['Uri'], type: 'movie' });
    expect(d.tmdb.searchMulti.mock.calls.map((c) => c[0])).toEqual(['Uri The Surgical Strike Hindi', 'Uri']);
    expect(d.tmdb.getDetails).toHaveBeenCalledWith('movie', 20);
  });

  it('says not_found below the asked-for confidence, without spending OMDb quota', async () => {
    const d = deps({ search: [hit({ name: 'Darker Things', popularity: 2 })] });
    expect(await createLookup(d)({ title: 'Dark Thing', minConfidence: 0.8 })).toEqual({ status: 'not_found' });
    expect(d.omdb.getByImdbId).not.toHaveBeenCalled();
    // The same guess is still good enough where no floor is asked for (a Netflix thumbnail names its title exactly).
    expect((await createLookup(d)({ title: 'Dark Thing' })).status).toBe('ok');
  });

  it('builds the cache key from the normalised title, year and type', () => {
    expect(matchKey({ title: 'Dark!', year: 2017, type: 'tv' })).toBe('dark|2017|tv');
    expect(matchKey({ title: 'x', imdbId: 'tt1' })).toBe('imdb:tt1');
  });
});

describe('lookup: re-titled and same-named films from YouTube uploads', () => {
  const film = (o: Partial<TmdbSearchHit>) =>
    hit({ media_type: 'movie', name: undefined, first_air_date: undefined, ...o });
  const withCast = (names: string[], over: Partial<TmdbDetails> = {}): TmdbDetails => ({
    ...details,
    name: undefined,
    title: 'Partner',
    release_date: '2023-07-28',
    first_air_date: undefined,
    external_ids: { imdb_id: 'tt0000001' },
    credits: { cast: names.map((name, order) => ({ id: order + 100, name, order })), crew: [] },
    ...over,
  });
  const partner2007 = film({ id: 1, title: 'Partner', release_date: '2007-06-08', popularity: 60 });
  const partner2023 = film({ id: 2, title: 'Partner', release_date: '2023-07-28', popularity: 8 });
  const cast: Record<number, TmdbDetails> = {
    1: withCast(['Salman Khan', 'Govinda'], { release_date: '2007-06-08' }),
    2: withCast(['Aadhi Pinisetty', 'Hansika Motwani']),
  };

  function castDeps() {
    const d = deps({ search: [partner2007, partner2023] });
    d.tmdb.getDetails.mockImplementation(async (_t: unknown, id: unknown) => cast[id as number]!);
    return d;
  }

  it('picks the same-named film that has the named people in its cast, even when the upload year is later', async () => {
    const d = castDeps();
    const result = await createLookup(d)({
      title: 'PARTNER', year: 2026, yearIsUpload: true, type: 'movie', minConfidence: 0.8,
      people: ['Aadhi Pinisetty', 'Hansika Motwani'],
    });
    expect(result.status === 'ok' && result.info.tmdbId).toBe(2);
  });

  it('says not_found when the name is shared by several films and none has the cast', async () => {
    const d = castDeps();
    const result = await createLookup(d)({
      title: 'PARTNER', year: 2026, yearIsUpload: true, type: 'movie', minConfidence: 0.8, people: ['Someone Else'],
    });
    expect(result).toEqual({ status: 'not_found' });
  });

  it('still finds a film with one exact name when the people named are a channel or singer', async () => {
    const d = deps({ search: [film({ id: 3, title: 'Oppenheimer', release_date: '2023-07-21', popularity: 90 })] });
    const result = await createLookup(d)({
      title: 'Oppenheimer', year: 2023, yearIsUpload: true, type: 'movie', minConfidence: 0.8, people: ['Universal Pictures'],
    });
    expect(result.status).toBe('ok');
  });

  it('accepts a film released before the upload year, since a dub comes later', () => {
    const bagheera = film({ title: 'Bagheera', release_date: '2024-10-31' });
    const q = { title: 'BAGHEERA', year: 2026, type: 'movie' as const };
    expect(scoreCandidate({ ...q, yearIsUpload: true }, bagheera)).toBeGreaterThan(0.8);
    expect(scoreCandidate(q, bagheera)).toBeLessThan(0.8);
    // A film that came out after the upload is still a poor fit.
    expect(scoreCandidate({ ...q, year: 2020, yearIsUpload: true }, bagheera)).toBeLessThan(0.8);
  });

  it('finds a dub sold under a new name from the films all its named actors share', async () => {
    const person = (id: number, name: string) => ({ id, name, popularity: 20 });
    const credit = (id: number, title: string, year: string, popularity: number) => ({
      id, media_type: 'movie' as const, title, release_date: year + '-01-01', popularity, vote_count: 10,
    });
    const d = deps({ search: [] });
    const tmdb = {
      ...d.tmdb,
      searchPerson: vi.fn(async (name: string) => [name.startsWith('Jr') ? person(1, 'Jr. NTR') : person(2, 'Pooja Hegde')]),
      getPersonCredits: vi.fn(async (id: number) =>
        id === 1
          ? [credit(50, 'Aravinda Sametha', '2018', 30), credit(51, 'Only NTR Film', '2019', 90)]
          : [credit(50, 'Aravinda Sametha', '2018', 30), credit(52, 'Only Pooja Film', '2024', 80)],
      ),
    };
    const result = await createLookup({ ...d, tmdb })({
      title: 'THE BOSS CM', type: 'movie', minConfidence: 0.8, people: ['Jr.NTR', 'Pooja Hegde'],
    });
    expect(result.status).toBe('ok');
    expect(d.tmdb.getDetails).toHaveBeenCalledWith('movie', 50);
  });

  it('does not guess from one person alone', async () => {
    const d = deps({ search: [] });
    const tmdb = {
      ...d.tmdb,
      searchPerson: vi.fn(async () => [{ id: 1, name: 'Vidyut Jammwal', popularity: 20 }]),
      getPersonCredits: vi.fn(async () => []),
    };
    const result = await createLookup({ ...d, tmdb })({ title: 'Commando 4', minConfidence: 0.8, people: ['Vidyut Jammwal'] });
    expect(result).toEqual({ status: 'not_found' });
  });
});
