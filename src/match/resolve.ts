import { hitTitle, hitYear, type TmdbSearchHit } from '../api/tmdb';
import type { MatchQuery } from './types';
import { normalizeTitle } from './parseTitle';
import { jaroWinkler } from './similarity';

export { MATCH_THRESHOLD } from './constants';

const W = { similarity: 0.6, year: 0.2, type: 0.1, popularity: 0.1 };

const compact = (normalized: string) => normalized.replace(/ /g, '');

/** True when the result's name is the searched name, give or take case, accents, punctuation and spacing. */
export function isExactName(title: string, hit: TmdbSearchHit): boolean {
  const wanted = compact(normalizeTitle(title));
  return [hitTitle(hit), hit.original_title ?? hit.original_name ?? ''].some((n) => n && compact(normalizeTitle(n)) === wanted);
}

/** How well one TMDB result fits what the page showed, from 0 to 1. */
export function scoreCandidate(q: MatchQuery, hit: TmdbSearchHit): number {
  const wanted = normalizeTitle(q.title);
  const names = [hitTitle(hit), hit.original_title ?? hit.original_name ?? ''].filter(Boolean).map(normalizeTitle);
  // Spacing aside, "KGF Chapter 2" is "K.G.F: Chapter 2".
  const similarity = Math.max(0, ...names.map((n) => (compact(n) === compact(wanted) ? 1 : jaroWinkler(wanted, n))));

  const hitY = hitYear(hit);
  let year = 0.5; // unknown on either side: neither for nor against
  if (q.year !== undefined && hitY !== undefined) {
    const gap = Math.abs(q.year - hitY);
    year = gap === 0 ? 1 : gap === 1 ? 0.7 : 0;
    // A dub is uploaded years after its film came out ("Bagheera (2026)" is the 2024 film), so only a film
    // that came out after the upload is a poor fit.
    if (q.yearIsUpload && hitY < q.year) year = Math.max(year, 0.6);
  }

  const type = q.type === undefined ? 0.5 : q.type === hit.media_type ? 1 : 0;

  // Popularity only breaks ties between same-named titles (a remake and its original).
  const popularity = Math.min(1, Math.log10(1 + Math.max(hit.popularity, 0)) / Math.log10(201));

  return W.similarity * similarity + W.year * year + W.type * type + W.popularity * popularity;
}

export interface BestMatch {
  hit: TmdbSearchHit;
  confidence: number;
}

export function pickBest(q: MatchQuery, hits: TmdbSearchHit[]): BestMatch | null {
  let best: BestMatch | null = null;
  for (const hit of hits) {
    const confidence = scoreCandidate(q, hit);
    if (!best || confidence > best.confidence) best = { hit, confidence };
  }
  return best;
}
