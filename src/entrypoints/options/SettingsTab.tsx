import { useEffect, useState } from 'preact/hooks';
import type { QuotaUsage } from '../../api/queue';
import { sendMessage, type KeyTestReport, type KeyTestResult } from '../../messaging/protocol';
import { SITE_IDS, getSettings, saveSettings, type Settings, type SiteId } from '../../settings';

const SITE_LABELS: Record<SiteId, string> = {
  netflix: 'Netflix',
  hotstar: 'JioHotstar',
  zee5: 'Zee5',
  youtube: 'YouTube',
  stremio: 'Stremio',
  torrent: 'Torrent sites',
};

function Result({ r }: { r: KeyTestResult | undefined }) {
  if (!r) return null;
  return (
    <span class={r.ok ? 'ok' : 'bad'}>
      {r.ok ? <>&#10003; </> : <>&#10007; </>}
      {r.message}
    </span>
  );
}

export function SettingsTab() {
  const [form, setForm] = useState<Settings | null>(null);
  const [report, setReport] = useState<KeyTestReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState<QuotaUsage | null>(null);

  const refreshQuota = () => sendMessage('getQuota').then(setQuota).catch(() => setQuota(null));

  useEffect(() => {
    void getSettings().then(setForm);
    void refreshQuota();
  }, []);

  if (!form) return <p class="muted">Loading&hellip;</p>;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm({ ...form, [key]: value });

  const saveAndTest = async () => {
    setBusy(true);
    setReport(null);
    try {
      await saveSettings(form);
      setReport(await sendMessage('testKeys'));
      await refreshQuota();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>API keys</h2>
      <p class="muted">
        Both are free. Keys stay in this browser only and are never saved to Drive or the backup folder.
      </p>
      <label>
        TMDB API key (or v4 read access token)
        <input type="password" value={form.tmdbKey} onInput={(e) => set('tmdbKey', e.currentTarget.value)} />
        <small>
          Get it at{' '}
          <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">
            themoviedb.org/settings/api
          </a>
          . <Result r={report?.tmdb} />
        </small>
      </label>
      <label>
        OMDb API key
        <input type="password" value={form.omdbKey} onInput={(e) => set('omdbKey', e.currentTarget.value)} />
        <small>
          Get it at{' '}
          <a href="https://www.omdbapi.com/apikey.aspx" target="_blank" rel="noreferrer">
            omdbapi.com/apikey.aspx
          </a>
          . Free keys allow 1,000 requests a day. <Result r={report?.omdb} />
        </small>
      </label>
      {quota && (
        <p class="muted">
          OMDb today: {quota.used} of {quota.limit} requests used.
        </p>
      )}

      <h2>Region</h2>
      <label>
        Country code used for where to stream
        <input
          type="text"
          maxLength={2}
          value={form.region}
          onInput={(e) => set('region', e.currentTarget.value.toUpperCase())}
          style="width: 4rem"
        />
      </label>

      <h2>Sites</h2>
      <div class="sites">
        {SITE_IDS.map((id) => (
          <label key={id} class="check">
            <input
              type="checkbox"
              checked={form.sites[id]}
              onChange={(e) => set('sites', { ...form.sites, [id]: e.currentTarget.checked })}
            />
            {SITE_LABELS[id]}
          </label>
        ))}
      </div>

      <p>
        <button class="primary" disabled={busy} onClick={saveAndTest}>
          {busy ? 'Testing...' : 'Save and test keys'}
        </button>
      </p>
    </section>
  );
}
