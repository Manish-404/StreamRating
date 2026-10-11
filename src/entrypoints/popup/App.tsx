import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { QuotaUsage } from '../../api/queue';
import { sendMessage } from '../../messaging/protocol';

export function App() {
  const [quota, setQuota] = useState<QuotaUsage | null>(null);
  useEffect(() => {
    sendMessage('getQuota').then(setQuota).catch(() => setQuota(null));
  }, []);

  return (
    <main>
      <h1>StreamRating</h1>
      {quota && <p>OMDb today: {quota.used} / {quota.limit}</p>}
      <button onClick={() => browser.runtime.openOptionsPage()}>Open dashboard</button>
    </main>
  );
}
