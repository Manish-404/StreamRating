import { storage } from 'wxt/utils/storage';

export const SITE_IDS = ['netflix', 'hotstar', 'zee5', 'youtube', 'stremio', 'torrent'] as const;
export type SiteId = (typeof SITE_IDS)[number];

/** Stored in browser.storage.local only. Keys and the Google client ID are never synced or exported. */
export interface Settings {
  tmdbKey: string;
  omdbKey: string;
  /** ISO 3166-1 country code used for "where to stream". */
  region: string;
  sites: Record<SiteId, boolean>;
  torrentDomains: string[];
  googleClientId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  tmdbKey: '',
  omdbKey: '',
  region: 'IN',
  sites: { netflix: true, hotstar: true, zee5: true, youtube: true, stremio: true, torrent: true },
  torrentDomains: [],
  googleClientId: '',
};

const settingsItem = storage.defineItem<Settings>('local:settings', { fallback: DEFAULT_SETTINGS });

export async function getSettings(): Promise<Settings> {
  const saved = await settingsItem.getValue();
  // Merge over defaults so settings added in later versions get a value for existing users.
  return { ...DEFAULT_SETTINGS, ...saved, sites: { ...DEFAULT_SETTINGS.sites, ...saved.sites } };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await settingsItem.setValue(next);
  return next;
}

export function watchSettings(cb: (s: Settings) => void): () => void {
  return settingsItem.watch(() => void getSettings().then(cb));
}
