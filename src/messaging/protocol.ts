import { defineExtensionMessaging } from '@webext-core/messaging';
import type { QuotaUsage } from '../api/queue';
import type { LookupResult, MatchQuery } from '../match/types';
import type { MediaType } from '../db/types';
import type { EpisodeResult } from '../services/episodeInfo';
import type { ReviewResult } from '../services/reviews';
import type { SeasonResult } from '../services/seasons';

export interface KeyTestResult {
  ok: boolean;
  message: string;
}

export interface KeyTestReport {
  tmdb: KeyTestResult;
  omdb: KeyTestResult;
}

/** Every message the pages and content scripts can send to the background. */
interface ProtocolMap {
  testKeys(): KeyTestReport;
  getQuota(): QuotaUsage;
  lookupTitle(query: MatchQuery): LookupResult;
  /** A TMDB poster path in, a data URL out (or null). */
  getPoster(path: string): string | null;
  /** IMDb rating of every episode in one season. */
  getSeason(args: { imdbId: string; season: number }): SeasonResult;
  /** Plot, air date, runtime and TMDB score of one episode. */
  getEpisode(args: { tmdbId: number; season: number; episode: number }): EpisodeResult;
  /** The most recent user review of a title. */
  getLatestReview(args: { type: MediaType; tmdbId: number }): ReviewResult;
  /** Content scripts cannot open the options page themselves. */
  openSettings(): void;
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
