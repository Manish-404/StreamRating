import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { QuotaUsage } from '../../api/queue';
import { countUserData } from '../../db/userData';
import { sendMessage } from '../../messaging/protocol';

export function App() {
  const [quota, setQuota] = useState<QuotaUsage | null>(null);
  const [counts, setCounts] = useState<Awaited<ReturnType<typeof countUserData>> | null>(null);
  useEffect(() => {
    sendMessage('getQuota').then(setQuota).catch(() => setQuota(null));
    countUserData().then(setCounts).catch(() => setCounts(null));
  }, []);

  return (
    <main>
      <h1>StreamRating</h1>
      {counts && (
        <p>
          Watched: {counts.watched} {counts.watched === 1 ? 'title' : 'titles'} · Watchlist: {counts.watchlist}
        </p>
      )}
      {quota && <p>OMDb today: {quota.used} / {quota.limit}</p>}
      <button onClick={() => browser.runtime.openOptionsPage()}>Open dashboard</button>
    </main>
  );
}
