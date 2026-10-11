import type { TmdbClient, TmdbReview } from '../api/tmdb';
import { cached } from '../db/cache';
import type { MediaType } from '../db/types';

export interface LatestReview {
  author: string;
  /** Out of 10, when the reviewer gave one. */
  rating: number | null;
  /** ISO date of the review. */
  date: string;
  /** Plain text, cut to a readable length. */
  text: string;
  truncated: boolean;
  url: string | null;
  /** How many reviews the title has in total. */
  total: number;
}

export type ReviewResult = { status: 'ok'; review: LatestReview } | { status: 'none' | 'error' };

const MAX_CHARS = 420;
const DAY = 24 * 60 * 60 * 1000;

/** Review text arrives as markdown with Windows line breaks; the card wants one plain paragraph. */
export function cleanReview(raw: string): { text: string; truncated: boolean } {
  const plain = raw
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= MAX_CHARS) return { text: plain, truncated: false };
  const cut = plain.slice(0, MAX_CHARS);
  return { text: cut.slice(0, Math.max(cut.lastIndexOf(' '), MAX_CHARS - 40)).trimEnd(), truncated: true };
}

export function pickLatest(reviews: TmdbReview[]): TmdbReview | null {
  let best: TmdbReview | null = null;
  for (const r of reviews) {
    if (!r.content?.trim()) continue;
    if (!best || Date.parse(r.created_at) > Date.parse(best.created_at)) best = r;
  }
  return best;
}

/** The most recent user review of a title. Cached for a day because new reviews keep arriving. */
export function createReviews(deps: { tmdb: Pick<TmdbClient, 'getReviews'> }) {
  return async function getLatestReview(type: MediaType, tmdbId: number): Promise<ReviewResult> {
    try {
      const data = await cached('reviews:' + type + ':' + tmdbId, DAY, () => deps.tmdb.getReviews(type, tmdbId));
      const latest = pickLatest(data.results);
      if (!latest) return { status: 'none' };
      const { text, truncated } = cleanReview(latest.content);
      return {
        status: 'ok',
        review: {
          author: latest.author_details?.name?.trim() || latest.author_details?.username || latest.author || 'Anonymous',
          rating: latest.author_details?.rating ?? null,
          date: latest.created_at,
          text,
          truncated,
          url: latest.url ?? null,
          total: data.total_results,
        },
      };
    } catch {
      return { status: 'error' };
    }
  };
}
