import { describe, expect, it, vi } from 'vitest';
import { ApiError, MissingKeyError } from '../src/api/errors';
import { Throttle } from '../src/api/queue';
import { TmdbClient, hitTitle, hitYear, type TmdbSearchHit } from '../src/api/tmdb';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const asFetch = (fn: unknown) => fn as typeof fetch;
// A fetch stand-in whose recorded calls are typed as plain argument lists.
const fetchMock = (impl: () => Promise<Response>) => vi.fn((..._args: unknown[]) => impl());
const open = () => new Throttle({ maxRequests: 1000, perMs: 1000 });

function client(fetchFn: unknown, key = 'abc123', sleepFn = async () => {}) {
  return new TmdbClient({ getKey: async () => key, fetchFn: asFetch(fetchFn), throttle: open(), sleepFn });
}

const lastUrl = (fn: { mock: { calls: unknown[][] } }, call = 0) => new URL(String(fn.mock.calls[call]?.[0]));

describe('TmdbClient', () => {
  it('sends a v3 key as the api_key query parameter', async () => {
    const fetchFn = fetchMock(async () => json({ results: [] }));
    await client(fetchFn).searchMulti('Inception');
    const url = lastUrl(fetchFn);
    expect(url.pathname).toBe('/3/search/multi');
    expect(url.searchParams.get('api_key')).toBe('abc123');
    expect(url.searchParams.get('query')).toBe('Inception');
  });

  it('sends a v4 read access token as a bearer header instead', async () => {
    const fetchFn = fetchMock(async () => json({ results: [] }));
    await client(fetchFn, 'eyJhbGciOi.payload.sig').searchMulti('x');
    expect(lastUrl(fetchFn).searchParams.has('api_key')).toBe(false);
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer eyJhbGciOi.payload.sig');
  });

  it('keeps only movies and series from a multi search', async () => {
    const results = [
      { id: 1, media_type: 'movie', title: 'A' },
      { id: 2, media_type: 'person', name: 'B' },
      { id: 3, media_type: 'tv', name: 'C' },
    ];
    const hits = await client(fetchMock(async () => json({ results }))).searchMulti('x');
    expect(hits.map((h) => h.id)).toEqual([1, 3]);
  });

  it('asks for external ids, credits and keywords with the details', async () => {
    const fetchFn = fetchMock(async () => json({ id: 603 }));
    await client(fetchFn).getDetails('movie', 603);
    const url = lastUrl(fetchFn);
    expect(url.pathname).toBe('/3/movie/603');
    expect(url.searchParams.get('append_to_response')).toBe('external_ids,credits,keywords');
  });

  it('looks up by IMDb id', async () => {
    const fetchFn = fetchMock(async () => json({ movie_results: [], tv_results: [] }));
    await client(fetchFn).findByImdbId('tt0133093');
    const url = lastUrl(fetchFn);
    expect(url.pathname).toBe('/3/find/tt0133093');
    expect(url.searchParams.get('external_source')).toBe('imdb_id');
  });

  it('throws MissingKeyError before any request when there is no key', async () => {
    const fetchFn = vi.fn();
    await expect(client(fetchFn, '  ').searchMulti('x')).rejects.toBeInstanceOf(MissingKeyError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('turns a rejected key into an ApiError carrying the TMDB message', async () => {
    const fetchFn = fetchMock(async () => json({ status_message: 'Invalid API key: You must be granted a valid key.' }, 401));
    const err = await client(fetchFn).validateKey().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.message).toContain('Invalid API key');
  });

  it('waits for Retry-After and tries again after a 429', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({}, 429, { 'retry-after': '3' }))
      .mockResolvedValueOnce(json({ results: [] }));
    const sleepFn = vi.fn(async () => {});
    await client(fetchFn, 'abc123', sleepFn).searchMulti('x');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledWith(3000);
  });

  it('gives up after repeated 429s', async () => {
    const fetchFn = fetchMock(async () => json({}, 429));
    const err = await client(fetchFn).searchMulti('x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});

describe('hitTitle and hitYear', () => {
  it('read movie and series hits alike', () => {
    const movie = { title: 'Heat', release_date: '1995-12-15' } as TmdbSearchHit;
    const show = { name: 'Dark', first_air_date: '2017-12-01' } as TmdbSearchHit;
    expect([hitTitle(movie), hitYear(movie)]).toEqual(['Heat', 1995]);
    expect([hitTitle(show), hitYear(show)]).toEqual(['Dark', 2017]);
  });

  it('return undefined for a missing or empty date', () => {
    expect(hitYear({ title: 'x', release_date: '' } as TmdbSearchHit)).toBeUndefined();
    expect(hitYear({ title: 'x' } as TmdbSearchHit)).toBeUndefined();
  });
});
