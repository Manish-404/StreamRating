import { ApiError, MissingKeyError, QuotaExceededError } from '../api/errors';
import type { OmdbClient, OmdbTitle } from '../api/omdb';
import { hitYear, type TmdbClient, type TmdbDetails } from '../api/tmdb';
import { TTL, cached } from '../db/cache';
import { db } from '../db/schema';
import type { MediaType } from '../db/types';
import { matchKey } from '../match/key';
import { pickBest } from '../match/resolve';
import type { LookupResult, MatchQuery, RatingsStatus, TitleInfo } from '../match/types';

const DAY = 24 * 60 * 60 * 1000;

/** Results with a best guess weaker than this are treated as "no such title". */
const NOT_FOUND_BELOW = 0.5;

interface MatchRef {
  tmdbId: number;
  type: MediaType;
  confidence: number;
}

export { matchKey };

export interface LookupDeps {
  tmdb: Pick<TmdbClient, 'searchMulti' | 'findByImdbId' | 'getDetails'>;
  omdb: Pick<OmdbClient, 'getByImdbId'>;
}

/** Misses are remembered for a day only, hits for a month. */
const refTtl = (v: MatchRef | null) => (v === null ? DAY : TTL.match);
const ratingsTtl = (v: OmdbTitle | null) => (v === null ? DAY : TTL.ratings);

export function createLookup(deps: LookupDeps) {
  async function resolveRef(q: MatchQuery): Promise<MatchRef | null> {
    const overrideIds = [q.platform && q.platformId ? q.platform + ':' + q.platformId : null, matchKey(q)];
    for (const id of overrideIds) {
      if (!id) continue;
      const o = await db.matchOverrides.get(id);
      if (o && !o.deleted) return { tmdbId: o.tmdbId, type: o.type, confidence: 1 };
    }

    return cached<MatchRef | null>('match:' + matchKey(q), refTtl, async () => {
      if (q.imdbId) {
        const found = await deps.tmdb.findByImdbId(q.imdbId);
        const movie = found.movie_results[0];
        const hit = movie ?? found.tv_results[0];
        return hit ? { tmdbId: hit.id, type: movie ? 'movie' : 'tv', confidence: 1 } : null;
      }
      const best = pickBest(q, await deps.tmdb.searchMulti(q.title));
      if (!best || best.confidence < NOT_FOUND_BELOW) return null;
      return { tmdbId: best.hit.id, type: best.hit.media_type, confidence: best.confidence };
    });
  }

  async function ratingsFor(imdbId: string | null): Promise<{ ratings: OmdbTitle | null; status: RatingsStatus }> {
    if (!imdbId) return { ratings: null, status: 'no_imdb_id' };
    try {
      const ratings = await cached<OmdbTitle | null>('omdb:' + imdbId, ratingsTtl, () => deps.omdb.getByImdbId(imdbId));
      return { ratings, status: ratings ? 'ok' : 'unavailable' };
    } catch (e) {
      if (e instanceof MissingKeyError) return { ratings: null, status: 'missing_key' };
      if (e instanceof QuotaExceededError) return { ratings: null, status: 'quota' };
      return { ratings: null, status: 'unavailable' };
    }
  }

  return async function lookup(q: MatchQuery): Promise<LookupResult> {
    try {
      const ref = await resolveRef(q);
      if (!ref) return { status: 'not_found' };
      const details = await cached<TmdbDetails>('tmdb:' + ref.type + ':' + ref.tmdbId, TTL.tmdb, () =>
        deps.tmdb.getDetails(ref.type, ref.tmdbId),
      );
      const imdbId = details.external_ids?.imdb_id || null;
      const { ratings, status } = await ratingsFor(imdbId);
      return { status: 'ok', info: buildInfo(matchKey(q), ref, details, imdbId, ratings, status) };
    } catch (e) {
      return toError(e);
    }
  };
}

function buildInfo(
  key: string,
  ref: MatchRef,
  d: TmdbDetails,
  imdbId: string | null,
  r: OmdbTitle | null,
  ratingsStatus: RatingsStatus,
): TitleInfo {
  const cast = (d.credits?.cast ?? []).slice().sort((a, b) => a.order - b.order).slice(0, 5).map((c) => c.name);
  const directors =
    ref.type === 'movie'
      ? (d.credits?.crew ?? []).filter((c) => c.job === 'Director').map((c) => c.name)
      : (d.created_by ?? []).map((c) => c.name);
  return {
    key,
    tmdbId: ref.tmdbId,
    type: ref.type,
    imdbId,
    title: d.title || d.name || '',
    year: hitYear(d),
    overview: d.overview,
    tagline: d.tagline || undefined,
    genres: d.genres.map((g) => g.name),
    runtimeMin: d.runtime || d.episode_run_time?.[0] || undefined,
    seasons: d.number_of_seasons,
    posterPath: d.poster_path,
    cast,
    directors,
    tmdbRating: d.vote_count > 0 ? d.vote_average : null,
    tmdbVotes: d.vote_count,
    imdbRating: r?.imdbRating ?? null,
    imdbVotes: r?.imdbVotes ?? null,
    rtCritics: r?.rtCritics ?? null,
    metacritic: r?.metacritic ?? null,
    ratingsStatus,
    confidence: ref.confidence,
  };
}

function toError(e: unknown): LookupResult {
  if (e instanceof MissingKeyError) return { status: 'error', kind: 'missing_key', message: e.message };
  if (e instanceof QuotaExceededError) return { status: 'error', kind: 'quota', message: e.message };
  if (e instanceof ApiError) return { status: 'error', kind: 'api', message: e.message };
  return { status: 'error', kind: 'network', message: e instanceof Error ? e.message : String(e) };
}
