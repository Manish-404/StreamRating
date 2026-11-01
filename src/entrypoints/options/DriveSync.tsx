import { useEffect, useState } from 'preact/hooks';
import { sendMessage } from '../../messaging/protocol';
import { getSettings, saveSettings } from '../../settings';
import { redirectUri } from '../../sync/googleAuth';
import { connectDrive, disconnectDrive, getSyncStatus, watchSyncStatus, type SyncStatus } from '../../sync/service';
import { formatDay } from './HistoryTab';

const when = (t: number) => formatDay(t) + ', ' + new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function safeRedirect() {
  try {
    return redirectUri();
  } catch {
    return '';
  }
}

export function DriveSync() {
  const [status, setStatus] = useState<SyncStatus>({ connected: false });
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void getSyncStatus().then(setStatus);
    void getSettings().then((s) => setClientId(s.googleClientId));
    return watchSyncStatus(setStatus);
  }, []);

  const attempt = async (job: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const connect = () =>
    attempt(async () => {
      const id = clientId.trim();
      if (!id) throw new Error('Paste your Google client ID first (step 5).');
      await saveSettings({ googleClientId: id });
      await connectDrive(id);
    });

  const redirect = safeRedirect();
  const signedIn = status.connected && !status.needsReconnect;

  return (
    <>
      <h2>Google Drive sync</h2>
      <p class="muted">
        Keeps one file, <code>streamrating-data.json</code>, in your own Google Drive and merges it with this browser, so the
        same watchlist and history appear in every browser and on every computer you connect. The extension can only see
        files it created itself. You set this up once; it uses your own Google project, so nothing passes through anyone else.
      </p>

      {signedIn ? (
        <>
          <p class={status.lastError ? 'bad' : 'ok'} role="status">
            {status.lastError
              ? 'Connected, but the last sync failed: ' + status.lastError
              : status.lastOkAt
                ? 'Connected. Last synced ' + when(status.lastOkAt) + (status.pulled ? ' (' + status.pulled + ' changes received)' : '') + '.'
                : 'Connected. Waiting for the first sync.'}
          </p>
          <div class="filters">
            <button class="primary" disabled={busy} onClick={() => void attempt(() => sendMessage('syncNow'))}>
              {busy ? 'Syncing...' : 'Sync now'}
            </button>
            <button class="quiet" disabled={busy} onClick={() => void attempt(disconnectDrive)}>
              Disconnect
            </button>
          </div>
          <p class="muted small">It also syncs by itself when the browser starts, a minute after you change something, and every 15 minutes.</p>
        </>
      ) : (
        <>
          {status.needsReconnect && (
            <p class="bad" role="status">
              {status.lastError || 'Google needs you to sign in again.'} Press Connect to sign in again.
            </p>
          )}
          <ol class="steps">
            <li>
              Open{' '}
              <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">
                Google Cloud Console
              </a>{' '}
              and create a project (any name).
            </li>
            <li>
              In <b>APIs &amp; Services &rarr; Library</b>, find <b>Google Drive API</b> and press Enable.
            </li>
            <li>
              In <b>OAuth consent screen</b> (Google Auth Platform), choose <b>External</b>, fill in the app name and your email, and
              add the scope <code>.../auth/drive.file</code>. Then set the publishing status to <b>In production</b>: in Testing mode Google
              ends your sign-in every 7 days. This scope needs no Google review.
            </li>
            <li>
              In <b>Credentials &rarr; Create credentials &rarr; OAuth client ID</b>, choose <b>Web application</b> and add this under
              <b> Authorized redirect URIs</b> (Chrome and Firefox each have their own address; add both to use both):
              <br />
              <code class="copy">{redirect || 'shown here once the extension runs'}</code>
            </li>
            <li>Copy the <b>Client ID</b> it shows and paste it here:</li>
          </ol>
          <input
            type="text"
            placeholder="123456789-abc.apps.googleusercontent.com"
            value={clientId}
            onInput={(e) => setClientId(e.currentTarget.value)}
            aria-label="Google client ID"
          />
          <p>
            <button class="primary" disabled={busy} onClick={() => void connect()}>
              {busy ? 'Waiting for Google...' : status.needsReconnect ? 'Reconnect' : 'Connect Google Drive'}
            </button>
          </p>
        </>
      )}
      {error && (
        <p class="bad" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
