import type { MediaType, Platform } from '../db/types';

/** What a site adapter could read off a thumbnail. */
export interface MatchQuery {
  title: string;
  year?: number;
  type?: MediaType;
  /** Present when the page itself carries an IMDb id (Stremio). The match is then exact. */
  imdbId?: string;
  platform?: Platform;
  /** The site's own id for the title, so a user correction sticks to it. */
  platformId?: string;
}

export type RatingsStatus = 'ok' | 'missing_key' | 'quota' | 'unavailable' | 'no_imdb_id';

/** Everything the badge and the hover card show about one title. */
export interface TitleInfo {
  key: string;
  tmdbId: number;
  type: MediaType;
  imdbId: string | null;
  title: string;
  year?: number;
  overview: string;
  tagline?: string;
  genres: string[];
  runtimeMin?: number;
  seasons?: number;
  posterPath: string | null;
  cast: string[];
  directors: string[];
  tmdbRating: number | null;
  tmdbVotes: number;
  imdbRating: number | null;
  imdbVotes: number | null;
  rtCritics: number | null;
  metacritic: number | null;
  ratingsStatus: RatingsStatus;
  /** 0..1. Below the match threshold the badge shows a question mark. */
  confidence: number;
}

export type LookupResult =
  | { status: 'ok'; info: TitleInfo }
  | { status: 'not_found' }
  | { status: 'error'; kind: 'missing_key' | 'quota' | 'api' | 'network'; message: string };
