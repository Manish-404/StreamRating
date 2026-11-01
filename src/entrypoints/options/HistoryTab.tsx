import { useState } from 'preact/hooks';
import type { HistoryEntry, Platform } from '../../db/types';
import { deleteHistoryEntry, listHistory } from '../../db/userData';
import { useLive } from './useLive';

export const PLATFORM_LABELS: Record<Platform, string> = {
  netflix: 'Netflix',
  hotstar: 'JioHotstar',
  zee5: 'Zee5',
  youtube: 'YouTube',
  stremio: 'Stremio',
  torrent: 'Torrent',
  manual: 'Added by hand',
};

export const formatDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

function describe(e: HistoryEntry): string {
  const parts: string[] = [];
  if (e.episode !== undefined) parts.push('Season ' + e.season + ', episode ' + e.episode);
  else parts.push(e.type === 'tv' ? 'Series' : 'Film');
  if (e.kind === 'interest') parts.push('trailer');
  else if (e.source === 'manual') parts.push('marked watched by you');
  else parts.push(e.progress >= 0.9 ? 'finished' : Math.round(e.progress * 100) + '% watched');
  return parts.join(' · ');
}

export function HistoryTab() {
  const entries = useLive(listHistory);
  const [platform, setPlatform] = useState<Platform | 'all'>('all');
  const [trailers, setTrailers] = useState(false);

  if (!entries) return <p class="muted">Loading&hellip;</p>;
  const platforms = [...new Set(entries.map((e) => e.platform))];
  const shown = entries.filter((e) => (platform === 'all' || e.platform === platform) && (trailers || e.kind === 'watch'));
  const hiddenTrailers = entries.filter((e) => e.kind === 'interest').length;

  return (
    <section>
      <h2>History</h2>
      <p class="muted">
        What you watched on Netflix and YouTube, newest first. A title is added after you have played it for five minutes
        (or 15% of it), and kept on this device only. Press <b>Mark watched</b> on a title's card to add one by hand.
      </p>
      <div class="filters">
        <label class="inline">
          Site
          <select value={platform} onChange={(e) => setPlatform(e.currentTarget.value as Platform | 'all')}>
            <option value="all">All sites</option>
            {platforms.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label class="check">
          <input type="checkbox" checked={trailers} onChange={(e) => setTrailers(e.currentTarget.checked)} />
          Include trailers{hiddenTrailers > 0 ? ' (' + hiddenTrailers + ')' : ''}
        </label>
      </div>
      {shown.length === 0 ? (
        <p class="muted">Nothing here yet. Play something on Netflix or YouTube for a few minutes and it will appear.</p>
      ) : (
        <ul class="list">
          {shown.map((e) => (
            <li key={e.id} class="row">
              <div class="row-main">
                <b>{e.title}</b>
                {e.year ? <span class="muted"> ({e.year})</span> : null}
                <div class="muted small">
                  {describe(e)} · {PLATFORM_LABELS[e.platform]} · {formatDay(e.watchedAt)}
                </div>
              </div>
              {e.imdbId && (
                <a class="small" href={'https://www.imdb.com/title/' + e.imdbId + '/'} target="_blank" rel="noreferrer">
                  IMDb ↗
                </a>
              )}
              <button class="quiet" onClick={() => void deleteHistoryEntry(e.id)} aria-label={'Remove ' + e.title + ' from History'}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
