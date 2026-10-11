import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, MissingKeyError, QuotaExceededError } from '../src/api/errors';
import { OmdbClient, parseOmdbSeason, parseOmdbTitle } from '../src/api/omdb';
import { DailyQuota, type KeyValueStore } from '../src/api/queue';

// Fixtures shaped like OMDb responses; the numbers are made up.
const movieJson = {
  Title: 'Sample Movie',
  Year: '1994',
  Runtime: '142 min',
  Genre: 'Drama',
  Plot: 'A short plot.',
  Ratings: [
    { Source: 'Internet Movie Database', Value: '9.3/10' },
    { Source: 'Rotten Tomatoes', Value: '89%' },
    { Source: 'Metacritic', Value: '82/100' },
  ],
  Metascore: '82',
  imdbRating: '9.3',
  imdbVotes: '2,950,123',
  imdbID: 'tt0111161',
  Type: 'movie',
  Response: 'True',
};

const seriesJson = {
  Title: 'Sample Show',
  Year: '2008-2013',
  Runtime: 'N/A',
  Plot: 'N/A',
  Ratings: [{ Source: 'Internet Movie Database', Value: '9.5/10' }],
  Metascore: 'N/A',
  imdbRating: '9.5',
  imdbVotes: '2,200,000',
  imdbID: 'tt0903747',
  Type: 'series',
  totalSeasons: '5',
  Response: 'True',
};

const seasonJson = {
  Title: 'Sample Show',
  Season: '1',
  totalSeasons: '5',
  Episodes: [
    { Title: 'Pilot', Released: '2008-01-20', Episode: '1', imdbRating: '9.0', imdbID: 'tt0959621' },
    { Title: 'Second', Released: 'N/A', Episode: '2', imdbRating: 'N/A', imdbID: 'tt1054724' },
  ],
  Response: 'True',
};

function memoryStore(): KeyValueStore {
  const data = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return data.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T) {
      data.set(key, value);
    },
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const asFetch = (fn: unknown) => fn as typeof fetch;
// A fetch stand-in whose recorded calls are typed as plain argument lists.
const fetchMock = (impl: () => Promise<Response>) => vi.fn((..._args: unknown[]) => impl());

describe('parseOmdbTitle', () => {
  it('reads IMDb, Rotten Tomatoes and Metacritic scores', () => {
    expect(parseOmdbTitle(movieJson)).toMatchObject({
      imdbId: 'tt0111161',
      imdbRating: 9.3,
      imdbVotes: 2950123,
      rtCritics: 89,
      metacritic: 82,
      runtimeMin: 142,
      type: 'movie',
    });
  });

  it('turns N/A into null', () => {
    const t = parseOmdbTitle(seriesJson);
    expect(t.rtCritics).toBeNull();
    expect(t.metacritic).toBeNull();
    expect(t.plot).toBeNull();
    expect(t.runtimeMin).toBeNull();
    expect(t.totalSeasons).toBe(5);
  });

  it('falls back to the Metacritic entry in Ratings when Metascore is missing', () => {
    const { Metascore: _drop, ...rest } = movieJson;
    expect(parseOmdbTitle(rest).metacritic).toBe(82);
  });
});

describe('parseOmdbSeason', () => {
  it('lists episodes with ratings', () => {
    const s = parseOmdbSeason(seasonJson);
    expect(s.season).toBe(1);
    expect(s.episodes).toEqual([
      { episode: 1, title: 'Pilot', released: '2008-01-20', imdbRating: 9, imdbId: 'tt0959621' },
      { episode: 2, title: 'Second', released: null, imdbRating: null, imdbId: 'tt1054724' },
    ]);
  });
});

describe('OmdbClient', () => {
  let quota: DailyQuota;
  beforeEach(() => {
    quota = new DailyQuota(memoryStore(), 'q', 1000, () => '2026-10-10');
  });

  const client = (fetchFn: unknown, key = 'KEY') => new OmdbClient({ getKey: async () => key, quota, fetchFn: asFetch(fetchFn) });

  it('looks a title up by IMDb id and sends the key', async () => {
    const fetchFn = fetchMock(async () => json(movieJson));
    const t = await client(fetchFn).getByImdbId('tt0111161');
    expect(t?.imdbRating).toBe(9.3);
    const url = new URL(String(fetchFn.mock.calls[0]?.[0]));
    expect(url.searchParams.get('i')).toBe('tt0111161');
    expect(url.searchParams.get('apikey')).toBe('KEY');
    expect((await quota.usage()).used).toBe(1);
  });

  it('returns null when OMDb does not know the title', async () => {
    const fetchFn = fetchMock(async () => json({ Response: 'False', Error: 'Incorrect IMDb ID.' }));
    expect(await client(fetchFn).getByImdbId('tt0')).toBeNull();
  });

  it('fetches a season', async () => {
    const fetchFn = fetchMock(async () => json(seasonJson));
    const s = await client(fetchFn).getSeason('tt0903747', 1);
    expect(s?.episodes).toHaveLength(2);
    expect(new URL(String(fetchFn.mock.calls[0]?.[0])).searchParams.get('Season')).toBe('1');
  });

  it('throws without spending quota when no key is set', async () => {
    const fetchFn = vi.fn();
    await expect(client(fetchFn, '').getByImdbId('tt1')).rejects.toBeInstanceOf(MissingKeyError);
    expect(fetchFn).not.toHaveBeenCalled();
    expect((await quota.usage()).used).toBe(0);
  });

  it('reports a rejected key as a 401 ApiError', async () => {
    const fetchFn = fetchMock(async () => json({ Response: 'False', Error: 'Invalid API key!' }, 401));
    const err = await client(fetchFn).getByImdbId('tt1').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
  });

  it('marks the day used up when OMDb says the limit is reached', async () => {
    const fetchFn = fetchMock(async () => json({ Response: 'False', Error: 'Request limit reached!' }));
    const c = client(fetchFn);
    await expect(c.getByImdbId('tt1')).rejects.toBeInstanceOf(QuotaExceededError);
    await expect(c.getByImdbId('tt2')).rejects.toBeInstanceOf(QuotaExceededError);
    expect(fetchFn).toHaveBeenCalledTimes(1); // the second call was refused locally
  });

  it('stops calling OMDb once the local daily allowance is gone', async () => {
    const small = new DailyQuota(memoryStore(), 'q', 1, () => '2026-10-10');
    const fetchFn = fetchMock(async () => json(movieJson));
    const c = new OmdbClient({ getKey: async () => 'K', quota: small, fetchFn: asFetch(fetchFn) });
    await c.getByImdbId('tt1');
    await expect(c.getByImdbId('tt2')).rejects.toBeInstanceOf(QuotaExceededError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
