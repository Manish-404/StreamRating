import { h, render } from 'preact';
import { scheduleClose, scheduleOpenView } from './card';
import { EpisodeCard } from './EpisodeCard';
import type { OmdbEpisode } from '../api/omdb';
import type { TitleInfo } from '../match/types';
import { sendMessage } from '../messaging/protocol';
import type { SeasonResult } from '../services/seasons';
import type { SiteAdapter } from '../sites/types';
import { describeEpisodes } from './diagnose';
import { outOfTenTone } from './format';
import css from './ui.css?inline';

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** The text element in a row that holds exactly the episode title, so the chip can sit right after it. */
function titleElement(row: HTMLElement, title: string): HTMLElement | null {
  const wanted = norm(title);
  if (!wanted) return null;
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (norm(n.textContent ?? '') === wanted && n.parentElement) return n.parentElement;
  }
  return null;
}

/** Puts each episode's IMDb rating beside its title in a detail screen's episode list. */
export function createEpisodeRatings(adapter: SiteAdapter) {
  const hosts = new Map<HTMLElement, HTMLElement>(); // row -> its chip host
  const seasons = new Map<string, SeasonResult>();
  const pending = new Set<string>();
  let missingSince = 0;
  let reportedFor = '';

  function clear(): void {
    for (const host of hosts.values()) host.remove();
    hosts.clear();
  }

  function chipFor(row: HTMLElement, ep: OmdbEpisode, info: TitleInfo, season: number): void {
    let host = hosts.get(row);
    if (!host) {
      host = document.createElement('streamrating-ep');
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = css;
      shadow.append(style, document.createElement('div'));
      hosts.set(row, host);
    }
    const anchor = titleElement(row, ep.title);
    if (anchor) {
      host.style.cssText = 'all: initial; display: inline-flex; vertical-align: middle; margin-left: 10px;';
      if (host.previousElementSibling !== anchor) anchor.after(host);
    } else {
      // Title not found by name: sit in the free space of the row's top line, clear of the runtime.
      if (getComputedStyle(row).position === 'static') row.style.position = 'relative';
      host.style.cssText = 'all: initial; position: absolute; top: 14px; right: 160px; z-index: 5;';
      if (host.parentElement !== row) row.append(host);
    }
    const mount = host.shadowRoot!.querySelector('div')!;
    const label = 'Episode ' + ep.episode + ': ' + ep.title + ' (IMDb)';
    const self = host;
    const open = (e: MouseEvent) =>
      scheduleOpenView(self, 'ep:' + info.tmdbId + ':' + season + ':' + ep.episode, h(EpisodeCard, { info, season, ep }), { x: e.clientX, y: e.clientY });
    render(
      h('span', { class: 'chip ep ' + outOfTenTone(ep.imdbRating!), title: label, onMouseEnter: open, onMouseLeave: scheduleClose }, h('b', null, 'IMDb'), ' ' + ep.imdbRating!.toFixed(1)),
      mount,
    );
  }

  return function update(info: TitleInfo | null): void {
    const found = info && info.type === 'tv' && info.imdbId ? adapter.episodes?.find(document) : null;
    if (!found || !info?.imdbId) {
      clear();
      // A series is open but no episode rows were recognised: after a few seconds, say what the page has instead.
      if (info?.type === 'tv' && adapter.episodes) {
        missingSince ||= Date.now();
        if (Date.now() - missingSince > 4000 && reportedFor !== location.href) {
          reportedFor = location.href;
          console.info('[StreamRating] episode list not recognised. ' + JSON.stringify(describeEpisodes()));
        }
      } else missingSince = 0;
      return;
    }
    missingSince = 0;
    const key = info.imdbId + ':' + found.season;
    const result = seasons.get(key);
    if (!result) {
      if (!pending.has(key)) {
        pending.add(key);
        sendMessage('getSeason', { imdbId: info.imdbId, season: found.season })
          .then((r) => seasons.set(key, r))
          .catch(() => seasons.set(key, { status: 'error' }))
          .finally(() => {
            pending.delete(key);
            update(info);
          });
      }
      return;
    }
    if (result.status !== 'ok') {
      clear();
      return;
    }
    const liveRows = new Set(found.rows.map((r) => r.row));
    for (const [row, host] of hosts) {
      if (!liveRows.has(row)) {
        host.remove();
        hosts.delete(row);
      }
    }
    for (const { episode, row } of found.rows) {
      const ep = result.season.episodes.find((e) => e.episode === episode);
      if (ep && ep.imdbRating !== null) chipFor(row, ep, info, found.season);
      else {
        hosts.get(row)?.remove();
        hosts.delete(row);
      }
    }
  };
}
