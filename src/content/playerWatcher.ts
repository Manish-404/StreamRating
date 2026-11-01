import type { PlayedInput, TitleKey } from '../db/userData';
import { MATCH_THRESHOLD } from '../match/constants';
import type { LookupResult, MatchQuery } from '../match/types';
import { sendMessage } from '../messaging/protocol';
import type { NowPlaying, SiteAdapter } from '../sites/types';
import { describePlayer } from './diagnose';
import { knownTitles } from './known';
import { createWatchTracker, type WatchEvent, type WatchTracker } from './watchTracker';

const TICK_MS = 1000;
/** How long a player page may stay unreadable before the page's markup is reported. */
const UNREADABLE_REPORT_MS = 25_000;

export interface WatcherLink {
  lookup(query: MatchQuery): Promise<LookupResult>;
  record(played: PlayedInput): Promise<unknown>;
}

const viaBackground: WatcherLink = {
  lookup: (query) => sendMessage('lookupTitle', query),
  record: (played) => sendMessage('recordPlayed', played),
};

/** What one watch of one video on the player page has collected so far. */
interface Session {
  pageKey: string;
  startedAt: number;
  playing?: NowPlaying;
  tracker?: WatchTracker;
  trailer: boolean;
  /** undefined until looked up; null when the playing video is not a film or series we can name. */
  title?: Promise<TitleKey | null | 'retry'>;
  /** A save that had to wait because the page had not yet said what is playing. */
  waiting?: WatchEvent;
  announced: boolean;
  reportedUnreadable: boolean;
}

/** The biggest painted video on the page: the player, not a preview tile. */
function mainVideo(doc: Document): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  let area = 0;
  for (const v of doc.querySelectorAll('video')) {
    const r = v.getBoundingClientRect();
    if (r.width * r.height > area) [best, area] = [v, r.width * r.height];
  }
  return best;
}

const pageKeyOf = (url: URL) => url.pathname + '?v=' + (url.searchParams.get('v') ?? '');

/**
 * Logs what is watched into the History. It reads the page's <video> once a second and counts real playback time only;
 * after five minutes (or 15% of the runtime) the title is looked up and saved, and the saved progress follows the video.
 * It never touches the player: it reads the title line and the video's clock.
 */
export function createPlayerWatcher(adapter: SiteAdapter, link: WatcherLink = viaBackground, now: () => number = Date.now) {
  const player = adapter.player;
  let session: Session | null = null;

  const name = (s: Session) => s.playing?.query.title ?? '(unknown)';

  async function save(s: Session, ev: WatchEvent): Promise<void> {
    if (!s.playing) {
      s.waiting = ev; // the title line is not showing yet; it is saved the moment it is
      return;
    }
    const playing = s.playing;
    s.title ??= link
      .lookup(playing.query)
      .then((r): TitleKey | null | 'retry' => {
        // A failed request (no network, the OMDb allowance used up) is tried again at the next save, not remembered as "no such title".
        if (r.status === 'error') return 'retry';
        if (r.status !== 'ok' || r.info.confidence < MATCH_THRESHOLD) {
          console.info('[StreamRating] history: "' + playing.query.title + '" is not saved because it could not be matched to a title (' + (r.status === 'ok' ? 'confidence ' + r.info.confidence.toFixed(2) : r.status) + ').');
          return null;
        }
        const { imdbId, tmdbId, type, title, year } = r.info;
        return { imdbId, tmdbId, type, title, ...(year !== undefined ? { year } : {}) };
      })
      .catch(() => 'retry' as const);
    const title = await s.title;
    if (title === 'retry') s.title = undefined;
    if (!title || title === 'retry') return;
    const episode = title.type === 'tv' && playing.season !== undefined && playing.episode !== undefined;
    await link
      .record({
        title,
        platform: adapter.platform,
        ...(episode ? { season: playing.season, episode: playing.episode } : {}),
        progress: ev.progress,
        ...(s.trailer ? { trailer: true } : {}),
      })
      .catch(() => {}); // the extension was reloaded under this page
  }

  function finish(): void {
    const ev = session?.tracker?.flush();
    if (session && ev) void save(session, ev);
  }

  function tick(): void {
    if (!player) return;
    const url = new URL(location.href);
    if (!player.isPlayerPage(url)) {
      finish();
      session = null;
      return;
    }
    const key = pageKeyOf(url);
    if (session?.pageKey !== key) {
      finish();
      session = { pageKey: key, startedAt: now(), trailer: false, announced: false, reportedUnreadable: false };
    }
    const s = session;

    // The page names the video only while its title line shows (Netflix hides it with the controls): keep the last reading.
    const playing = player.nowPlaying(document, knownTitles);
    if (playing) {
      s.playing = playing;
      if (s.waiting) {
        const ev = s.waiting;
        s.waiting = undefined;
        void save(s, ev);
      }
    }
    if (player.reportUnreadable && !s.playing && !s.reportedUnreadable && now() - s.startedAt > UNREADABLE_REPORT_MS) {
      s.reportedUnreadable = true;
      console.info('[StreamRating] history: cannot tell what is playing on ' + adapter.id + ', so nothing is saved. ' + JSON.stringify(describePlayer()));
    }

    const video = mainVideo(document);
    if (!video) return;
    const advert = player.adPlaying?.(document) ?? false;
    const playingNow = !video.paused && !video.ended && video.readyState >= 3 && !advert;
    // An advert has its own length, so the video's kind (trailer or not) is only judged outside one.
    if (!s.tracker && !advert && Number.isFinite(video.duration) && video.duration > 0) {
      s.trailer = player.trailerMaxSeconds !== undefined && video.duration <= player.trailerMaxSeconds;
      s.tracker = createWatchTracker({ trailer: s.trailer });
    }
    if (!s.tracker) return;
    const ev = s.tracker.sample({ position: video.currentTime, duration: video.duration, playing: playingNow });
    if (ev) {
      if (!s.announced) console.info('[StreamRating] history: saving "' + name(s) + '"' + (s.playing?.episode !== undefined ? ' S' + s.playing.season + 'E' + s.playing.episode : '') + ' from ' + adapter.id + (s.trailer ? ' (trailer)' : ''));
      s.announced = true;
      void save(s, ev);
    } else if (!playingNow) {
      finish(); // paused or stopped: save where it got to
    }
  }

  return { tick, finish };
}

/** Starts logging what is played on a site that has a player adapter. */
export function startPlayerWatcher(adapter: SiteAdapter): void {
  if (!adapter.player) return;
  const watcher = createPlayerWatcher(adapter);
  window.setInterval(watcher.tick, TICK_MS);
  // Leaving the page: save where playback got to if the browser lets the message out.
  window.addEventListener('pagehide', watcher.finish);
}
