import { ApiError, MissingKeyError, QuotaExceededError } from '../api/errors';
import type { OmdbClient, OmdbTitle } from '../api/omdb';
import { hitYear, type TmdbClient, type TmdbCredit, type TmdbDetails, type TmdbSearchHit } from '../api/tmdb';
import { TTL, cached } from '../db/cache';
import { db } from '../db/schema';
import type { MediaType } from '../db/types';
import { matchKey } from '../match/key';
import { normalizeTitle } from '../match/parseTitle';
import { isExactName, pickBest, scoreCandidate, type BestMatch } from '../match/resolve';
import { jaroWinkler } from '../match/similarity';
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

/** How sure a film found only through its cast is. Above a YouTube title's minimum, since the cast agreed. */
const CAST_MATCH_CONFIDENCE = 0.85;
/** The most named people looked up when a title's own name finds nothing: each costs two requests. */
const MAX_PEOPLE_LOOKUPS = 3;
/** A film found by name is checked against this many of the best-scoring results. */
const MAX_VERIFIED_HITS = 4;

/** "Jr.NTR" is "Jr. NTR"; "Rashmika" is "Rashmika Mandanna". */
function samePerson(a: string, b: string): boolean {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return false;
  if (x.replace(/ /g, '') === y.replace(/ /g, '') || jaroWinkler(x, y) >= 0.92) return true;
  const [short, long] = x.split(' ').length <= y.split(' ').length ? [x, y] : [y, x];
  const longWords = long.split(' ');
  const shortWords = short.split(' ');
  return shortWords.some((w) => w.length >= 4) && shortWords.every((w) => longWords.includes(w));
}

/** How many of the named people acted in or directed this film. */
function castOverlap(people: string[], d: TmdbDetails): number {
  const names = [
    ...(d.credits?.cast ?? []).map((c) => c.name),
    ...(d.credits?.crew ?? []).filter((c) => c.job === 'Director').map((c) => c.name),
  ];
  return people.filter((p) => names.some((n) => samePerson(p, n))).length;
}

const creditYear = (c: TmdbCredit) => {
  const year = Number((c.release_date || c.first_air_date || '').slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : undefined;
};


export interface LookupDeps {
  tmdb: Pick<TmdbClient, 'searchMulti' | 'findByImdbId' | 'getDetails'> & Partial<Pick<TmdbClient, 'searchPerson' | 'getPersonCredits'>>;
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

    const alternatives = (q.alternatives?.length ? '|' + q.alternatives.join('|') : '') + (q.people?.length ? '|with:' + q.people.join(',') : '');
    return cached<MatchRef | null>('match:' + matchKey(q) + alternatives, refTtl, async () => {
      if (q.imdbId) {
        const found = await deps.tmdb.findByImdbId(q.imdbId);
        const movie = found.movie_results[0];
        const hit = movie ?? found.tv_results[0];
        return hit ? { tmdbId: hit.id, type: movie ? 'movie' : 'tv', confidence: 1 } : null;
      }
      // Each reading of the name is searched in turn. A result whose name is exactly the reading wins and stops the
      // search, so "Scary Movie" (tried first) is not lost to a film called "Scary"; otherwise the best score wins.
      // When the title names people, the film must also have them in its cast: "Partner" is a dozen films.
      const people = q.people ?? [];
      let best: BestMatch | null = null;
      for (const title of [q.title, ...(q.alternatives ?? [])]) {
        const hits = await deps.tmdb.searchMulti(title);
        if (people.length > 0) {
          const verified = await verifiedByCast({ ...q, title }, hits, people);
          if (verified) return verified;
        }
        const found = pickBest({ ...q, title }, hits);
        // The people may be a channel or a singer, so they cannot rule a film out. They do settle between
        // same-named films, though: with no cast to go on, "Partner" could be any of a dozen.
        if (found && people.length > 0 && hits.filter((h) => isExactName(title, h)).length > 1) continue;
        if (!found) continue;
        if (isExactName(title, found.hit)) {
          best = found;
          break;
        }
        if (!best || found.confidence > best.confidence) best = found;
      }
      if ((!best || best.confidence < NOT_FOUND_BELOW) && people.length > 0) return foundByPeople(q, people);
      if (!best || best.confidence < NOT_FOUND_BELOW) return null;
      return { tmdbId: best.hit.id, type: best.hit.media_type, confidence: best.confidence };
    });
  }


  const detailsOf = (type: MediaType, id: number) => cached<TmdbDetails>('tmdb:' + type + ':' + id, TTL.tmdb, () => deps.tmdb.getDetails(type, id));

  /** The best-scoring result that has the named people in its cast, or null. */
  async function verifiedByCast(q: MatchQuery, hits: TmdbSearchHit[], people: string[]): Promise<MatchRef | null> {
    const ranked = hits
      .map((hit) => ({ hit, score: scoreCandidate(q, hit) }))
      .filter((r) => r.score >= NOT_FOUND_BELOW)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_VERIFIED_HITS);
    for (const { hit, score } of ranked) {
      const details = await detailsOf(hit.media_type, hit.id);
      if (castOverlap(people, details) > 0) return { tmdbId: hit.id, type: hit.media_type, confidence: Math.max(score, CAST_MATCH_CONFIDENCE) };
    }
    return null;
  }

  /**
   * A dub is often uploaded under a new name ("THE BOSS CM"), so the name finds nothing. The people named in the
   * title still do: the film is one that all of them acted in, released before the upload.
   */
  async function foundByPeople(q: MatchQuery, people: string[]): Promise<MatchRef | null> {
    const { searchPerson, getPersonCredits } = deps.tmdb;
    if (!searchPerson || !getPersonCredits) return null;
    const credits: TmdbCredit[][] = [];
    for (const name of people.slice(0, MAX_PEOPLE_LOOKUPS)) {
      const hit = (await searchPerson(name)).find((p) => samePerson(name, p.name));
      if (hit) credits.push(await getPersonCredits(hit.id));
    }
    // One person is in too many films to say which; two or more narrow it down.
    if (credits.length < 2) return null;
    const common = credits[0]!.filter((c) => credits.every((list) => list.some((o) => o.id === c.id && o.media_type === c.media_type)));
    const fits = common.filter((c) => {
      const year = creditYear(c);
      if (q.type && c.media_type !== q.type) return false;
      return year === undefined || q.year === undefined || year <= q.year;
    });
    const top = fits.sort((a, b) => b.popularity - a.popularity)[0];
    return top ? { tmdbId: top.id, type: top.media_type, confidence: CAST_MATCH_CONFIDENCE } : null;
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
      // Checked before any rating is fetched, so a doubtful YouTube guess costs no OMDb quota.
      if (!ref || ref.confidence < (q.minConfidence ?? 0)) return { status: 'not_found' };
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
