import type { KeyTestReport, KeyTestResult } from '../messaging/protocol';
import { ApiError, MissingKeyError, QuotaExceededError } from './errors';

async function check(run: () => Promise<void>): Promise<KeyTestResult> {
  try {
    await run();
    return { ok: true, message: 'Key works' };
  } catch (e) {
    if (e instanceof MissingKeyError) return { ok: false, message: 'No key entered' };
    if (e instanceof QuotaExceededError) return { ok: false, message: 'Daily limit reached, so the key could not be checked' };
    if (e instanceof ApiError && e.status === 401) return { ok: false, message: 'The key was rejected: ' + e.message };
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function testKeys(
  tmdb: { validateKey(): Promise<void> },
  omdb: { validateKey(): Promise<void> },
): Promise<KeyTestReport> {
  const [t, o] = await Promise.all([check(() => tmdb.validateKey()), check(() => omdb.validateKey())]);
  return { tmdb: t, omdb: o };
}
