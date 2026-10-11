import type { MediaType } from '../db/types';
import { ApiError, MissingKeyError } from './errors';
import { Throttle, sleep } from './queue';

const BASE = 'https://api.themoviedb.org/3';

export interface TmdbSearchHit {
  id: number;
  media_type: MediaType;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  popularity: number;
  vote_average: number;
  vote_count: number;
  poster_path: string | null;
  overview: string;
  original_language: string;
  genre_ids: number[];
}

export interface TmdbDetails {
  id: number;
  title?: string;
  name?: string;
  overview: string;
  tagline?: string;
  release_date?: string;
  first_air_date?: string;
  runtime?: number;
  episode_run_time?: number[];
  number_of_seasons?: number;
  genres: { id: number; name: string }[];
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  vote_count: number;
  original_language: string;
  external_ids?: { imdb_id: string | null };
  credits?: {
    cast: { id: number; name: string; order: number }[];
    crew: { id: number; name: string; job: string }[];
  };
  /** Movies use `keywords`, series use `results`. */
  keywords?: { keywords?: { id: number; name: string }[]; results?: { id: number; name: string }[] };
  created_by?: { id: number; name: string }[];
}

export interface TmdbReview {
  id: string;
  author: string;
  content: string;
  created_at: string;
  updated_at?: string;
  url?: string;
  author_details?: { name?: string; username?: string; rating?: number | null };
}

export interface TmdbEpisode {
  name: string;
  overview: string;
  air_date?: string | null;
  runtime?: number | null;
  vote_average: number;
  vote_count: number;
  still_path: string | null;
}

export interface TmdbFindResult {
  movie_results: TmdbSearchHit[];
  tv_results: TmdbSearchHit[];
}

export const hitTitle = (h: TmdbSearchHit | TmdbDetails) => h.title || h.name || '';
export const hitYear = (h: TmdbSearchHit | TmdbDetails): number | undefined => {
  const date = h.release_date || h.first_air_date;
  const year = date ? Number(date.slice(0, 4)) : NaN;
  return Number.isFinite(year) ? year : undefined;
};

export interface TmdbClientDeps {
  getKey: () => Promise<string>;
  fetchFn?: typeof fetch;
  throttle?: Throttle;
  sleepFn?: (ms: number) => Promise<void>;
}

export class TmdbClient {
  private fetchFn: typeof fetch;
  private throttle: Throttle;
  private sleepFn: (ms: number) => Promise<void>;

  constructor(private deps: TmdbClientDeps) {
    // Wrapped so fetch keeps its this (calling it detached throws "Illegal invocation").
    this.fetchFn = deps.fetchFn ?? ((input, init) => fetch(input, init));
    // TMDB allows about 30 requests per 10 s per IP; stay under it.
    this.throttle = deps.throttle ?? new Throttle({ maxRequests: 20, perMs: 10_000, maxConcurrent: 10 });
    this.sleepFn = deps.sleepFn ?? sleep;
  }

  private async request<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const key = (await this.deps.getKey()).trim();
    if (!key) throw new MissingKeyError('tmdb');

    // A v4 read access token is a long JWT and goes in a header; a v3 key goes in the query string.
    const bearer = key.startsWith('eyJ');
    const url = new URL(BASE + path);
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
    if (!bearer) url.searchParams.set('api_key', key);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (bearer) headers.authorization = 'Bearer ' + key;
    const init: RequestInit = { headers };

    for (let attempt = 0; ; attempt++) {
      const res = await this.throttle.run(() => this.fetchFn(url.toString(), init));
      if (res.status === 429 && attempt < 2) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await this.sleepFn((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2) * 1000);
        continue;
      }
      if (!res.ok) throw new ApiError('tmdb', res.status, await errorMessage(res));
      return (await res.json()) as T;
    }
  }

  /** Throws if the key is missing or rejected. */
  async validateKey(): Promise<void> {
    await this.request<{ success: boolean }>('/authentication');
  }

  async searchMulti(query: string): Promise<TmdbSearchHit[]> {
    const data = await this.request<{ results: TmdbSearchHit[] }>('/search/multi', {
      query,
      include_adult: 'false',
    });
    return data.results.filter((r) => r.media_type === 'movie' || r.media_type === 'tv');
  }

  /** Exact lookup from an IMDb id (Stremio links carry one). */
  findByImdbId(imdbId: string): Promise<TmdbFindResult> {
    return this.request<TmdbFindResult>('/find/' + encodeURIComponent(imdbId), { external_source: 'imdb_id' });
  }

  getEpisode(tvId: number, season: number, episode: number): Promise<TmdbEpisode> {
    return this.request('/tv/' + tvId + '/season/' + season + '/episode/' + episode);
  }

  /** One page (up to 20) of user reviews. TMDB does not promise an order, so sort by date yourself. */
  getReviews(type: MediaType, id: number): Promise<{ results: TmdbReview[]; total_results: number }> {
    return this.request('/' + type + '/' + id + '/reviews');
  }

  getDetails(type: MediaType, id: number): Promise<TmdbDetails> {
    return this.request<TmdbDetails>('/' + type + '/' + id, { append_to_response: 'external_ids,credits,keywords' });
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { status_message?: string };
    if (body.status_message) return body.status_message;
  } catch {
    // not JSON
  }
  return 'TMDB responded with HTTP ' + res.status;
}
