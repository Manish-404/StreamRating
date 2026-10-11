import { ApiError, MissingKeyError, QuotaExceededError } from './errors';
import { DailyQuota, Throttle } from './queue';

const BASE = 'https://www.omdbapi.com/';

export interface OmdbTitle {
  imdbId: string;
  title: string;
  year: string;
  type: 'movie' | 'series' | 'episode' | string;
  imdbRating: number | null;
  imdbVotes: number | null;
  /** Rotten Tomatoes Tomatometer (critics), 0-100. OMDb rarely has it for series. */
  rtCritics: number | null;
  /** Metacritic Metascore, 0-100. */
  metacritic: number | null;
  plot: string | null;
  genre: string | null;
  runtimeMin: number | null;
  rated: string | null;
  awards: string | null;
  poster: string | null;
  totalSeasons: number | null;
}

export interface OmdbEpisode {
  episode: number;
  title: string;
  released: string | null;
  imdbRating: number | null;
  imdbId: string;
}

export interface OmdbSeason {
  season: number;
  totalSeasons: number | null;
  episodes: OmdbEpisode[];
}

type Raw = Record<string, unknown>;

// OMDb writes N/A for anything it does not know.
const str = (v: unknown): string | null => (typeof v === 'string' && v !== 'N/A' && v !== '' ? v : null);
const num = (v: unknown): number | null => {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

function ratingFrom(raw: Raw, source: string): string | null {
  const list = Array.isArray(raw.Ratings) ? (raw.Ratings as { Source?: string; Value?: string }[]) : [];
  return list.find((r) => r.Source === source)?.Value ?? null;
}

export function parseOmdbTitle(raw: Raw): OmdbTitle {
  const rt = ratingFrom(raw, 'Rotten Tomatoes'); // looks like 92%
  const meta = num(raw.Metascore) ?? num(ratingFrom(raw, 'Metacritic')?.split('/')[0]); // looks like 80/100
  return {
    imdbId: String(raw.imdbID ?? ''),
    title: String(raw.Title ?? ''),
    year: String(raw.Year ?? ''),
    type: String(raw.Type ?? ''),
    imdbRating: num(raw.imdbRating),
    imdbVotes: num(raw.imdbVotes),
    rtCritics: rt ? num(rt.replace('%', '')) : null,
    metacritic: meta,
    plot: str(raw.Plot),
    genre: str(raw.Genre),
    runtimeMin: num(str(raw.Runtime)?.replace(/\s*min.*/i, '')),
    rated: str(raw.Rated),
    awards: str(raw.Awards),
    poster: str(raw.Poster),
    totalSeasons: num(raw.totalSeasons),
  };
}

export function parseOmdbSeason(raw: Raw): OmdbSeason {
  const episodes = Array.isArray(raw.Episodes) ? (raw.Episodes as Raw[]) : [];
  return {
    season: num(raw.Season) ?? 0,
    totalSeasons: num(raw.totalSeasons),
    episodes: episodes.map((e) => ({
      episode: num(e.Episode) ?? 0,
      title: String(e.Title ?? ''),
      released: str(e.Released),
      imdbRating: num(e.imdbRating),
      imdbId: String(e.imdbID ?? ''),
    })),
  };
}

export interface OmdbClientDeps {
  getKey: () => Promise<string>;
  quota: DailyQuota;
  fetchFn?: typeof fetch;
  throttle?: Throttle;
}

export class OmdbClient {
  private fetchFn: typeof fetch;
  private throttle: Throttle;

  constructor(private deps: OmdbClientDeps) {
    this.fetchFn = deps.fetchFn ?? ((input, init) => fetch(input, init));
    this.throttle = deps.throttle ?? new Throttle({ maxRequests: 10, perMs: 1_000, maxConcurrent: 4 });
  }

  /** Returns the JSON body. A not-found answer (Response False) is returned; key and quota problems throw. */
  private async call(params: Record<string, string>): Promise<Raw> {
    const key = (await this.deps.getKey()).trim();
    if (!key) throw new MissingKeyError('omdb');
    if (!(await this.deps.quota.tryConsume())) throw new QuotaExceededError('omdb');

    const url = new URL(BASE);
    url.searchParams.set('apikey', key);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);

    const res = await this.throttle.run(() => this.fetchFn(url.toString()));
    let body: Raw | null = null;
    try {
      body = (await res.json()) as Raw;
    } catch {
      // not JSON
    }
    if (!body) throw new ApiError('omdb', res.status, 'OMDb responded with HTTP ' + res.status);

    if (body.Response === 'False') {
      const message = String(body.Error ?? '');
      if (/limit/i.test(message)) {
        await this.deps.quota.markExhausted();
        throw new QuotaExceededError('omdb');
      }
      if (/api key/i.test(message)) throw new ApiError('omdb', 401, message);
    } else if (!res.ok) {
      throw new ApiError('omdb', res.status, 'OMDb responded with HTTP ' + res.status);
    }
    return body;
  }

  /** Throws if the key is missing or rejected. */
  async validateKey(): Promise<void> {
    await this.call({ i: 'tt0111161' });
  }

  async getByImdbId(imdbId: string): Promise<OmdbTitle | null> {
    const body = await this.call({ i: imdbId, plot: 'short' });
    return body.Response === 'True' ? parseOmdbTitle(body) : null;
  }

  async getSeason(imdbId: string, season: number): Promise<OmdbSeason | null> {
    const body = await this.call({ i: imdbId, Season: String(season) });
    return body.Response === 'True' ? parseOmdbSeason(body) : null;
  }
}
