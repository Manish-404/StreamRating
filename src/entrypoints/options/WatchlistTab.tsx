import { listWatchlist, removeFromWatchlist } from '../../db/userData';
import { syncSoon } from '../../sync/notify';
import { formatDay } from './HistoryTab';
import { useLive } from './useLive';

export function WatchlistTab() {
  const entries = useLive(listWatchlist);
  if (!entries) return <p class="muted">Loading&hellip;</p>;

  return (
    <section>
      <h2>Watchlist</h2>
      <p class="muted">Titles you saved with <b>+ Watchlist</b> on a title's card, newest first. Kept on this device only.</p>
      {entries.length === 0 ? (
        <p class="muted">Nothing saved yet. Hover a title on Netflix or YouTube and press + Watchlist.</p>
      ) : (
        <ul class="list">
          {entries.map((e) => (
            <li key={e.id} class="row">
              <div class="row-main">
                <b>{e.title}</b>
                {e.year ? <span class="muted"> ({e.year})</span> : null}
                <div class="muted small">
                  {e.type === 'tv' ? 'Series' : 'Film'} · saved {formatDay(e.addedAt)}
                </div>
              </div>
              {e.imdbId && (
                <a class="small" href={'https://www.imdb.com/title/' + e.imdbId + '/'} target="_blank" rel="noreferrer">
                  IMDb ↗
                </a>
              )}
              <button class="quiet" onClick={() => void removeFromWatchlist(e.id).then(syncSoon)} aria-label={'Remove ' + e.title + ' from the watchlist'}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
