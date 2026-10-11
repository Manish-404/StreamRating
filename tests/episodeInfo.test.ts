import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/errors';
import { db } from '../src/db/schema';
import { createEpisodeInfo } from '../src/services/episodeInfo';

const raw = { name: 'Impact', overview: 'A crisis sends the Robinsons hurtling.', air_date: '2018-04-13', runtime: 63, vote_average: 7.9, vote_count: 120, still_path: '/s.jpg' };

beforeEach(async () => {
  await db.cache.clear();
});

describe('getEpisode', () => {
  it('returns plot, air date, runtime and score, and caches it', async () => {
    const getEpisode = vi.fn(async (..._a: unknown[]) => raw);
    const get = createEpisodeInfo({ tmdb: { getEpisode } });
    expect(await get(75758, 1, 1)).toEqual({
      status: 'ok',
      episode: { name: 'Impact', overview: raw.overview, airDate: '2018-04-13', runtimeMin: 63, tmdbRating: 7.9, tmdbVotes: 120, stillPath: '/s.jpg' },
    });
    await get(75758, 1, 1);
    expect(getEpisode).toHaveBeenCalledTimes(1);
  });

  it('has no score when nobody voted, says none for an unknown episode, error on failures', async () => {
    const quiet = await createEpisodeInfo({ tmdb: { getEpisode: async () => ({ ...raw, vote_count: 0, vote_average: 0 }) } })(1, 1, 1);
    expect(quiet.status === 'ok' && quiet.episode.tmdbRating).toBeNull();
    expect(await createEpisodeInfo({ tmdb: { getEpisode: async () => Promise.reject(new ApiError('tmdb', 404, 'not found')) } })(1, 9, 9)).toEqual({ status: 'none' });
    expect(await createEpisodeInfo({ tmdb: { getEpisode: async () => Promise.reject(new Error('boom')) } })(1, 1, 2)).toEqual({ status: 'error' });
  });
});
