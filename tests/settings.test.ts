import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, MissingKeyError, QuotaExceededError } from '../src/api/errors';
import { testKeys } from '../src/api/testKeys';
import { DEFAULT_SETTINGS, getSettings, saveSettings } from '../src/settings';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('settings', () => {
  it('starts from the defaults', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('saves a partial change and keeps the rest', async () => {
    await saveSettings({ tmdbKey: 'abc', region: 'US' });
    const s = await getSettings();
    expect(s.tmdbKey).toBe('abc');
    expect(s.region).toBe('US');
    expect(s.sites.netflix).toBe(true);
  });

  it('fills in site toggles that an older saved version did not have', async () => {
    await fakeBrowser.storage.local.set({ settings: { ...DEFAULT_SETTINGS, sites: { netflix: false } } });
    const s = await getSettings();
    expect(s.sites.netflix).toBe(false);
    expect(s.sites.zee5).toBe(true);
  });
});

describe('testKeys', () => {
  const ok = { validateKey: vi.fn(async () => {}) };
  const failing = (e: Error) => ({ validateKey: vi.fn(async () => Promise.reject(e)) });

  it('reports each key on its own', async () => {
    const report = await testKeys(ok, failing(new MissingKeyError('omdb')));
    expect(report.tmdb).toEqual({ ok: true, message: 'Key works' });
    expect(report.omdb).toEqual({ ok: false, message: 'No key entered' });
  });

  it('explains a rejected key and a used-up quota', async () => {
    const report = await testKeys(failing(new ApiError('tmdb', 401, 'Invalid API key')), failing(new QuotaExceededError('omdb')));
    expect(report.tmdb.ok).toBe(false);
    expect(report.tmdb.message).toContain('rejected');
    expect(report.omdb.message).toContain('Daily limit');
  });
});
