import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/schema';
import { listWatchlist, removeFromWatchlist, setWatchlisted, type TitleKey } from '../src/db/userData';
import { createDriveTarget, DRIVE_FILE_NAME, type SyncTarget } from '../src/sync/drive';
import { syncOnce } from '../src/sync/engine';
import { authUrl, getAccessToken, NeedsReconnect, parseAuthResponse } from '../src/sync/googleAuth';
import { sameRecords, supersedes } from '../src/sync/merge';
import { armSoon } from '../src/sync/schedule';
import { connectDrive, disconnectDrive, getSyncStatus, runSync, type SyncDeps } from '../src/sync/service';

const film: TitleKey = { imdbId: 'tt15398776', tmdbId: 872585, type: 'movie', title: 'Oppenheimer', year: 2023 };
const other: TitleKey = { imdbId: 'tt1375666', tmdbId: 27205, type: 'movie', title: 'Inception', year: 2010 };

beforeEach(async () => {
  fakeBrowser.reset();
  await Promise.all([db.history.clear(), db.watchlist.clear(), db.reactions.clear(), db.matchOverrides.clear()]);
});

/** A Drive file kept in memory. */
function memoryTarget(initial: string | null = null) {
  const t = { text: initial, writes: 0 };
  const target: SyncTarget = {
    read: async () => t.text,
    write: async (text) => {
      t.text = text;
      t.writes++;
    },
  };
  return { t, target };
}

describe('merge rule', () => {
  const rec = (updatedAt: number, deleted = false) => ({ id: 'a', updatedAt, ...(deleted ? { deleted: true } : {}) });
  it('takes the newer copy, and anything over nothing', () => {
    expect(supersedes(rec(2), rec(1))).toBe(true);
    expect(supersedes(rec(1), rec(2))).toBe(false);
    expect(supersedes(rec(1), undefined)).toBe(true);
  });
  it('lets a delete win a tie, but never the other way round', () => {
    expect(supersedes(rec(5, true), rec(5))).toBe(true);
    expect(supersedes(rec(5), rec(5, true))).toBe(false);
    expect(supersedes(rec(5), rec(5))).toBe(false);
  });
  it('compares record sets by id, time and delete mark', () => {
    expect(sameRecords([rec(1)], [rec(1)])).toBe(true);
    expect(sameRecords([rec(1)], [rec(2)])).toBe(false);
    expect(sameRecords([rec(1)], [rec(1, true)])).toBe(false);
    expect(sameRecords([rec(1)], [])).toBe(false);
  });
});

describe('google sign-in', () => {
  const redirect = 'https://abc.chromiumapp.org/';
  const answer = (token: string, seconds = 3599) => redirect + '#access_token=' + token + '&token_type=Bearer&expires_in=' + seconds + '&scope=x';

  it('asks for the drive.file scope only, and for a silent answer unless a window is allowed', () => {
    const quiet = new URL(authUrl('cid', redirect, false));
    expect(quiet.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(quiet.searchParams.get('response_type')).toBe('token');
    expect(quiet.searchParams.get('redirect_uri')).toBe(redirect);
    expect(quiet.searchParams.get('prompt')).toBe('none');
    expect(new URL(authUrl('cid', redirect, true)).searchParams.has('prompt')).toBe(false);
  });

  it('reads the token and its lifetime from the address Google sends back', () => {
    expect(parseAuthResponse(answer('tok', 100), 1000)).toEqual({ accessToken: 'tok', expiresAt: 101_000 });
  });

  it('turns Google refusing, or answering without a token, into a reconnect request', () => {
    expect(() => parseAuthResponse(redirect + '#error=interaction_required')).toThrow(/interaction_required/);
    expect(() => parseAuthResponse(redirect + '#foo=1')).toThrow(NeedsReconnect);
  });

  it('reuses the token until it is about to expire, then asks again without a window', async () => {
    const flow = vi.fn(async () => answer('one'));
    expect(await getAccessToken('cid', false, { now: 0, flow, redirect })).toBe('one');
    expect(await getAccessToken('cid', false, { now: 3_000_000, flow, redirect })).toBe('one');
    expect(flow).toHaveBeenCalledTimes(1);
    flow.mockImplementation(async () => answer('two'));
    expect(await getAccessToken('cid', false, { now: 3_560_000, flow, redirect })).toBe('two');
    expect(flow).toHaveBeenCalledTimes(2);
    expect(flow).toHaveBeenLastCalledWith(expect.stringContaining('prompt=none'), false);
  });

  it('always opens the window when the user pressed Connect', async () => {
    const flow = vi.fn(async () => answer('one'));
    await getAccessToken('cid', false, { now: 0, flow, redirect });
    await getAccessToken('cid', true, { now: 1, flow, redirect });
    expect(flow).toHaveBeenCalledTimes(2);
    expect(flow).toHaveBeenLastCalledWith(expect.not.stringContaining('prompt=none'), true);
  });

  it('needs a reconnect when the silent flow fails, and when there is no client id', async () => {
    const failing = async () => {
      throw new Error('user interaction required');
    };
    await expect(getAccessToken('cid', false, { flow: failing, redirect })).rejects.toBeInstanceOf(NeedsReconnect);
    await expect(getAccessToken('  ', true, { flow: failing, redirect })).rejects.toBeInstanceOf(NeedsReconnect);
  });

  it('shows the user why an interactive sign-in failed', async () => {
    const closed = async () => {
      throw new Error('The user did not approve access.');
    };
    await expect(getAccessToken('cid', true, { flow: closed, redirect })).rejects.toThrow(/did not approve/);
  });
});

describe('drive file', () => {
  /** Just enough of Drive: a list, a download, a create and an update, checking the bearer token on each. */
  function fakeDrive(opts: { existing?: string; failWith?: { status: number; body: unknown } } = {}) {
    const log: Array<{ method: string; url: string }> = [];
    const d = { text: opts.existing ?? null as string | null, created: 0 };
    const fetchFn = vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      log.push({ method, url });
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
      if (opts.failWith) return new Response(JSON.stringify(opts.failWith.body), { status: opts.failWith.status });
      if (method === 'GET' && url.includes('alt=media')) return new Response(d.text ?? '');
      if (method === 'GET') return new Response(JSON.stringify({ files: d.text === null ? [] : [{ id: 'F1' }] }));
      if (method === 'POST') {
        d.created++;
        d.text = String(init.body).split('\r\n\r\n')[2]!.split('\r\n--')[0]!;
        expect(String(init.body)).toContain('"name":"' + DRIVE_FILE_NAME + '"');
        return new Response(JSON.stringify({ id: 'F1' }));
      }
      d.text = String(init.body);
      return new Response('{}');
    });
    return { d, log, target: createDriveTarget(async () => 'tok', fetchFn as unknown as typeof fetch) };
  }

  it('reads nothing when no file exists, creates it on the first write and updates it after', async () => {
    const { d, log, target } = fakeDrive();
    expect(await target.read()).toBeNull();
    await target.write('{"a":1}');
    expect(d).toEqual({ text: '{"a":1}', created: 1 });
    await target.write('{"a":2}');
    expect(d).toEqual({ text: '{"a":2}', created: 1 });
    expect(log.map((l) => l.method)).toEqual(['GET', 'POST', 'PATCH']);
    expect(log[2]!.url).toContain('/upload/drive/v3/files/F1?uploadType=media');
  });

  it('downloads the existing file', async () => {
    const { target } = fakeDrive({ existing: '{"hello":true}' });
    expect(await target.read()).toBe('{"hello":true}');
  });

  it('asks for a new sign-in when Google says the token is no good', async () => {
    const { target } = fakeDrive({ failWith: { status: 401, body: { error: { message: 'Invalid Credentials' } } } });
    await expect(target.read()).rejects.toBeInstanceOf(NeedsReconnect);
  });

  it('tells the user to enable the Drive API when it is switched off', async () => {
    const body = { error: { message: 'Google Drive API has not been used in project 1 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }] } };
    const { target } = fakeDrive({ failWith: { status: 403, body } });
    await expect(target.read()).rejects.toThrow(/Enable it there/);
  });
});

describe('sync round', () => {
  it('uploads a first file, then does not rewrite it while nothing changed', async () => {
    await setWatchlisted(film, true, 1000);
    const { t, target } = memoryTarget();
    expect(await syncOnce(target, 5000)).toEqual({ pulled: 0, pushed: true });
    expect(JSON.parse(t.text!).tables.watchlist).toHaveLength(1);
    expect(await syncOnce(target, 6000)).toEqual({ pulled: 0, pushed: false });
    expect(t.writes).toBe(1);
  });

  it('brings the lists back on a device that lost its data', async () => {
    await setWatchlisted(film, true, 1000);
    const { target } = memoryTarget();
    await syncOnce(target);
    await db.watchlist.clear();
    expect(await syncOnce(target)).toEqual({ pulled: 1, pushed: false });
    expect((await listWatchlist()).map((e) => e.title)).toEqual(['Oppenheimer']);
  });

  it('merges what two devices did apart, and a removal reaches the other device', async () => {
    // Device A saves Oppenheimer and syncs.
    await setWatchlisted(film, true, 1000);
    const { t, target } = memoryTarget();
    await syncOnce(target);
    const afterA = t.text!;
    // Device B (empty) syncs, adds Inception, removes Oppenheimer, syncs.
    await db.watchlist.clear();
    await syncOnce(target);
    await setWatchlisted(other, true, 2000);
    await removeFromWatchlist(film.imdbId!, 3000);
    await syncOnce(target);
    // Device A comes back still holding its old state: it receives both changes.
    await db.watchlist.clear();
    await importOld(afterA);
    expect((await listWatchlist()).map((e) => e.title)).toEqual(['Oppenheimer']);
    await syncOnce(target);
    expect((await listWatchlist()).map((e) => e.title)).toEqual(['Inception']);
  });

  it('keeps a newer local change instead of overwriting it with the older file', async () => {
    await setWatchlisted(film, true, 1000);
    const { t, target } = memoryTarget();
    await syncOnce(target);
    await removeFromWatchlist(film.imdbId!, 9000);
    expect(await syncOnce(target)).toEqual({ pulled: 0, pushed: true });
    expect(JSON.parse(t.text!).tables.watchlist[0].deleted).toBe(true);
  });

  it('stops without writing when the file cannot be read, so it is never overwritten by mistake', async () => {
    await setWatchlisted(film, true, 1000);
    const { t, target } = memoryTarget('this is not json');
    await expect(syncOnce(target)).rejects.toThrow(/not valid JSON/);
    expect(t).toEqual({ text: 'this is not json', writes: 0 });
  });
});

/** Puts a saved file's records into the database as an import would. */
async function importOld(text: string) {
  const { importBackup, parseBackup } = await import('../src/db/backup');
  await importBackup(parseBackup(text));
}

describe('sync service', () => {
  const deps = (target: SyncTarget, clientId = 'cid'): SyncDeps => ({ clientId: async () => clientId, target: () => target, now: () => 7000 });

  it('does nothing until Drive is connected', async () => {
    const target = { read: vi.fn(), write: vi.fn() };
    expect(await runSync(deps(target))).toEqual({ connected: false });
    expect(target.read).not.toHaveBeenCalled();
  });

  it('records the outcome of a good round', async () => {
    await fakeBrowser.storage.local.set({ syncStatus: { connected: true } });
    await setWatchlisted(film, true, 1000);
    const status = await runSync(deps(memoryTarget().target));
    expect(status).toMatchObject({ connected: true, lastOkAt: 7000, needsReconnect: false, pushed: true });
    expect(await getSyncStatus()).toMatchObject({ lastOkAt: 7000 });
  });

  it('asks to reconnect when Google no longer accepts the sign-in, and keeps the error otherwise', async () => {
    await fakeBrowser.storage.local.set({ syncStatus: { connected: true } });
    const expired: SyncTarget = { read: async () => { throw new NeedsReconnect(); }, write: async () => {} };
    expect(await runSync(deps(expired))).toMatchObject({ connected: true, needsReconnect: true });
    const down: SyncTarget = { read: async () => { throw new Error('network down'); }, write: async () => {} };
    expect(await runSync(deps(down))).toMatchObject({ connected: true, lastError: 'network down' });
  });

  it('lets calls that arrive during a round share it', async () => {
    await fakeBrowser.storage.local.set({ syncStatus: { connected: true } });
    const target = { read: vi.fn(async () => null), write: vi.fn(async () => {}) };
    await Promise.all([runSync(deps(target)), runSync(deps(target)), runSync(deps(target))]);
    expect(target.read).toHaveBeenCalledTimes(1);
  });

  it('connects through the sign-in window and syncs, and disconnecting forgets the sign-in', async () => {
    vi.spyOn(fakeBrowser.identity, 'getRedirectURL').mockReturnValue('https://x.chromiumapp.org/');
    const launch = vi.spyOn(fakeBrowser.identity, 'launchWebAuthFlow').mockResolvedValue('https://x.chromiumapp.org/#access_token=t&expires_in=3000' as never);
    // runSync needs a client id from settings and a Drive target: here the round fails on the network, which is fine,
    // the point is that Connect marks the account connected after a sign-in.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await fakeBrowser.storage.local.set({ settings: { googleClientId: 'cid' } });
    const status = await connectDrive('cid');
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ interactive: true }));
    expect(status.connected).toBe(true);
    await disconnectDrive();
    expect(await getSyncStatus()).toEqual({ connected: false });
    expect((await fakeBrowser.storage.local.get('googleToken')).googleToken).toBeUndefined();
  });
});

describe('planning a sync after a change', () => {
  const waiting = () => fakeBrowser.alarms.get('sync-soon');

  it('plans one when something changed after the last good sync', async () => {
    await fakeBrowser.storage.local.set({ syncStatus: { connected: true, syncedUpTo: 5000 } });
    await setWatchlisted(film, true, 6000);
    await armSoon();
    expect(await waiting()).toBeTruthy();
  });

  it('plans nothing when everything is older than the last sync, or Drive is not connected', async () => {
    await fakeBrowser.storage.local.set({ syncStatus: { connected: true, syncedUpTo: 5000 } });
    await setWatchlisted(film, true, 4000);
    await armSoon();
    expect(await waiting()).toBeUndefined();
    await fakeBrowser.storage.local.set({ syncStatus: { connected: false } });
    await setWatchlisted(other, true, 9000);
    await armSoon();
    expect(await waiting()).toBeUndefined();
  });

  it('keeps the plan it already has instead of pushing it back', async () => {
    await fakeBrowser.storage.local.set({ syncStatus: { connected: true, syncedUpTo: 0 } });
    await setWatchlisted(film, true, 6000);
    await armSoon();
    const first = (await waiting())!.scheduledTime;
    await new Promise((r) => setTimeout(r, 5));
    await armSoon();
    expect((await waiting())!.scheduledTime).toBe(first);
  });
});
