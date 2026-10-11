import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TmdbReview } from '../src/api/tmdb';
import { db } from '../src/db/schema';
import { cleanReview, createReviews, pickLatest } from '../src/services/reviews';

const review = (o: Partial<TmdbReview>): TmdbReview => ({ id: 'a', author: 'someone', content: 'Good show.', created_at: '2026-01-01T00:00:00.000Z', ...o });

beforeEach(async () => {
  await db.cache.clear();
});

describe('pickLatest', () => {
  it('takes the newest review whatever order TMDB sends them in, and skips empty ones', () => {
    const list = [review({ id: '1', created_at: '2025-05-01T00:00:00Z' }), review({ id: '2', created_at: '2026-03-01T00:00:00Z' }), review({ id: '3', created_at: '2027-01-01T00:00:00Z', content: '   ' })];
    expect(pickLatest(list)?.id).toBe('2');
    expect(pickLatest([])).toBeNull();
  });
});

describe('cleanReview', () => {
  it('flattens markdown and line breaks into one paragraph', () => {
    expect(cleanReview('**Great**\r\n\r\nSee [this](http://x.y) _now_').text).toBe('Great See this now');
  });

  it('cuts a long review at a word boundary and says so', () => {
    const out = cleanReview('word '.repeat(300));
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(420);
    expect(out.text.endsWith('word')).toBe(true);
  });
});

describe('getLatestReview', () => {
  it('returns the latest review with author, score and count, and caches it', async () => {
    const getReviews = vi.fn(async (..._a: unknown[]) => ({
      total_results: 2,
      results: [
        review({ id: '1', created_at: '2025-01-01T00:00:00Z', author: 'old' }),
        review({ id: '2', created_at: '2026-06-01T00:00:00Z', author: 'new', author_details: { name: '', username: 'newbie', rating: 8 }, url: 'https://t/r/2' }),
      ],
    }));
    const get = createReviews({ tmdb: { getReviews } });
    const r = await get('tv', 66732);
    expect(r).toMatchObject({ status: 'ok', review: { author: 'newbie', rating: 8, total: 2, url: 'https://t/r/2', truncated: false } });
    await get('tv', 66732);
    expect(getReviews).toHaveBeenCalledTimes(1);
  });

  it('says none when there are no reviews and error when the request fails', async () => {
    expect(await createReviews({ tmdb: { getReviews: async () => ({ total_results: 0, results: [] }) } })('movie', 1)).toEqual({ status: 'none' });
    expect(await createReviews({ tmdb: { getReviews: async () => Promise.reject(new Error('x')) } })('movie', 2)).toEqual({ status: 'error' });
  });
});
