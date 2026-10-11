import { normalizeTitle } from './parseTitle';
import type { MatchQuery } from './types';

/** The key a match is cached under, and the key a user correction is stored under. */
export function matchKey(q: MatchQuery): string {
  if (q.imdbId) return 'imdb:' + q.imdbId;
  return [normalizeTitle(q.title), q.year ?? '', q.type ?? ''].join('|');
}
