import { h, render } from 'preact';
import { matchKey } from '../match/key';
import type { MatchQuery, TitleInfo } from '../match/types';
import { sendMessage } from '../messaging/protocol';
import type { SiteAdapter } from '../sites/types';
import { Badge } from './Badge';
import { scheduleClose, scheduleOpen } from './card';
import { describeDetail } from './diagnose';
import { createEpisodeRatings } from './episodes';
import { knownTitles } from './known';
import type { BadgeState } from './state';
import css from './ui.css?inline';

/**
 * Shows the ratings inside a site's detail screen, as part of the page (not floating), so it cannot cover the
 * artwork, the text or the video. Call the returned function whenever the page may have changed.
 */
export function createDetail(adapter: SiteAdapter) {
  let host: HTMLElement | null = null;
  let mount: HTMLElement | null = null;
  let key = '';
  let reportedFor = '';
  let info: TitleInfo | null = null;
  const updateEpisodes = createEpisodeRatings(adapter);

  const paint = (state: BadgeState) =>
    mount && render(h('div', { class: 'detail' }, h(Badge, { state, onEnter: (_el, info, at) => host && scheduleOpen(host, info, at), onLeave: scheduleClose, onSetup: () => void sendMessage('openSettings').catch(() => {}) })), mount);

  function ensureHost(): HTMLElement {
    if (host) return host;
    host = document.createElement('streamrating-detail');
    host.style.cssText =
      'all: initial; ' + (adapter.detail?.hostStyle ?? 'display: inline-flex; align-items: center; margin-left: 14px; vertical-align: middle;');
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    mount = document.createElement('div');
    shadow.append(style, mount);
    return host;
  }

  async function load(query: MatchQuery, forKey: string) {
    let next: BadgeState;
    try {
      const result = await sendMessage('lookupTitle', query);
      next =
        result.status === 'ok'
          ? { status: 'ready', info: result.info }
          : result.status === 'not_found'
            ? { status: query.minConfidence !== undefined ? 'unlisted' : 'none' }
            : { status: 'error', kind: result.kind, message: result.message };
    } catch {
      next = { status: 'none' };
    }
    if (key !== forKey) return;
    paint(next);
    info = next.status === 'ready' ? next.info : null;
    updateEpisodes(info);
  }

  return function update(): void {
    const found = adapter.detail?.find(document, knownTitles);
    if (!found) {
      host?.remove();
      key = '';
      info = null;
      updateEpisodes(null);
      // A title id in the address but nowhere to put the chips: say what the page offers, once per address.
      const wantsDetail = /[?&]jbv=\d+|\/title\/\d+/.test(location.href) && !location.pathname.startsWith('/watch');
      if (wantsDetail && reportedFor !== location.href) {
        reportedFor = location.href;
        console.info('[StreamRating] detail screen open but ratings could not be placed. ' + JSON.stringify(describeDetail()));
      }
      return;
    }
    const k = matchKey(found.query) + '@' + found.query.platformId;
    const el = ensureHost();
    if (key === k && el.parentElement === found.anchor) {
      updateEpisodes(info); // the episode list changes when the season is switched
      return;
    }
    found.anchor.append(el);
    if (key !== k) {
      key = k;
      paint({ status: 'loading' });
      void load(found.query, k);
    }
  };
}
