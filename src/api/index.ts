import { getSettings } from '../settings';
import { OmdbClient } from './omdb';
import { DailyQuota, browserLocalStore } from './queue';
import { TmdbClient } from './tmdb';

/** OMDb's free key allows 1,000 requests a day. */
export const omdbQuota = new DailyQuota(browserLocalStore, 'omdbQuota', 1000);

export const tmdb = new TmdbClient({ getKey: async () => (await getSettings()).tmdbKey });
export const omdb = new OmdbClient({ getKey: async () => (await getSettings()).omdbKey, quota: omdbQuota });
