import type { TmdbClient, TmdbEpisode } from '../api/tmdb';
import { TTL, cached } from '../db/cache';

export interface EpisodeDetails {
  name: string;
  overview: string;
  airDate: string | null;
  runtimeMin: number | null;
  tmdbRating: number | null;
  tmdbVotes: number;
  stillPath: string | null;
}

export type EpisodeResult = { status: 'ok'; episode: EpisodeDetails } | { status: 'none' | 'error' };

/** Details of one episode (plot, air date, runtime, TMDB score). Kept for a week. */
export function createEpisodeInfo(deps: { tmdb: Pick<TmdbClient, 'getEpisode'> }) {
  return async function getEpisode(tmdbId: number, season: number, episode: number): Promise<EpisodeResult> {
    try {
      const e = await cached<TmdbEpisode | null>('tmdbEp:' + tmdbId + ':' + season + ':' + episode, TTL.tmdb, async () => {
        try {
          return await deps.tmdb.getEpisode(tmdbId, season, episode);
        } catch (err) {
          if (err instanceof Error && (err as { status?: number }).status === 404) return null;
          throw err;
        }
      });
      if (!e) return { status: 'none' };
      return {
        status: 'ok',
        episode: {
          name: e.name,
          overview: e.overview,
          airDate: e.air_date || null,
          runtimeMin: e.runtime || null,
          tmdbRating: e.vote_count > 0 ? e.vote_average : null,
          tmdbVotes: e.vote_count,
          stillPath: e.still_path,
        },
      };
    } catch {
      return { status: 'error' };
    }
  };
}
