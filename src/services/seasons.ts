import { MissingKeyError, QuotaExceededError } from '../api/errors';
import type { OmdbClient, OmdbSeason } from '../api/omdb';
import { TTL, cached } from '../db/cache';

export type SeasonResult =
  | { status: 'ok'; season: OmdbSeason }
  | { status: 'not_found' | 'quota' | 'missing_key' | 'error' };

const DAY = 24 * 60 * 60 * 1000;

/** Episode ratings for one season. Season data changes while a show airs, so it is kept for a week at most. */
export function createSeasons(deps: { omdb: Pick<OmdbClient, 'getSeason'> }) {
  return async function getSeason(imdbId: string, season: number): Promise<SeasonResult> {
    try {
      const data = await cached<OmdbSeason | null>(
        'omdbSeason:' + imdbId + ':' + season,
        (v) => (v === null ? DAY : TTL.ratings),
        () => deps.omdb.getSeason(imdbId, season),
      );
      return data ? { status: 'ok', season: data } : { status: 'not_found' };
    } catch (e) {
      if (e instanceof QuotaExceededError) return { status: 'quota' };
      if (e instanceof MissingKeyError) return { status: 'missing_key' };
      return { status: 'error' };
    }
  };
}
