import { defineExtensionMessaging } from '@webext-core/messaging';
import type { QuotaUsage } from '../api/queue';
import type { LookupResult, MatchQuery } from '../match/types';
import type { MediaType, Platform } from '../db/types';
import type { PlayedInput, TitleKey, TitleState } from '../db/userData';
import type { AdvisoryQuery, AdvisoryResult } from '../services/advisory';
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
  /** Sex/nudity, violence/gore and language scores from Kids-In-Mind and IMDb's Parents Guide. */
  getAdvisory(args: AdvisoryQuery): AdvisoryResult;
  /** The watcher saw a title being played: log it in the history (or move its progress on). */
  recordPlayed(args: PlayedInput): void;
  /** Whether the title is on the watchlist and in the history, for the card's buttons. */
  getTitleState(title: TitleKey): TitleState;
  /** The card's Watched button. */
  setWatched(args: { title: TitleKey; platform: Platform; watched: boolean }): TitleState;
  /** The card's Watchlist button. */
  setWatchlisted(args: { title: TitleKey; on: boolean }): TitleState;
  /** Content scripts cannot open the options page themselves. */
  openSettings(): void;
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
