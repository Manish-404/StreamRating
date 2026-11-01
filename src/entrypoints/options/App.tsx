import { useState } from 'preact/hooks';
import { DataTab } from './DataTab';
import { HistoryTab } from './HistoryTab';
import { SettingsTab } from './SettingsTab';
import { WatchlistTab } from './WatchlistTab';

const TABS = [
  { id: 'history', label: 'History' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'foryou', label: 'For You', milestone: 7 },
  { id: 'settings', label: 'Settings' },
  { id: 'data', label: 'Data' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function App() {
  const [tab, setTab] = useState<TabId>('settings');
  const current = TABS.find((t) => t.id === tab);

  return (
    <main>
      <header>
        <h1>StreamRating</h1>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} class={t.id === tab ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      {tab === 'settings' ? (
        <SettingsTab />
      ) : tab === 'history' ? (
        <HistoryTab />
      ) : tab === 'watchlist' ? (
        <WatchlistTab />
      ) : tab === 'data' ? (
        <DataTab />
      ) : (
        <p class="muted">{current?.label} is not built yet. It arrives in milestone {current && 'milestone' in current ? current.milestone : '?'}.</p>
      )}
    </main>
  );
}
