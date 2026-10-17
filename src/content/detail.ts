import { h, render } from 'preact';
import { matchKey } from '../match/key';
import type { MatchQuery, TitleInfo } from '../match/types';
import { sendMessage } from '../messaging/protocol';
import type { SiteAdapter } from '../sites/types';
import { Badge } from './Badge';
import { scheduleClose, scheduleOpen } from './card';
import { describeBillboard, describeDetail } from './diagnose';
import { createEpisodeRatings } from './episodes';
import { knownTitles } from './known';
import type { BadgeState } from './state';
import css from './ui.css?inline';

interface Place {
  find(doc: Document, known: Map<string, MatchQuery>): { query: MatchQuery; anchor: HTMLElement } | null;
  hostStyle?: string;
}

interface Hooks {
  /** The rated title (null while loading or when there is none). Called again on every update while it stays. */
  onInfo?(info: TitleInfo | null): void;
  /** Called on every update in which the place was found, and in which it was not. */
  onFound?(): void;
  onMissing?(): void;
}

/**
 * Shows the ratings for one title as part of the page (not floating), next to an element the adapter picks, so
 * it cannot cover the artwork, the text or the video. Call the returned function whenever the page may have changed.
 */
function createPlacement(tag: string, place: Place | undefined, hooks: Hooks) {
  let host: HTMLElement | null = null;
  let mount: HTMLElement | null = null;
  let key = '';
  let info: TitleInfo | null = null;

  const paint = (state: BadgeState) =>
    mount && render(h('div', { class: 'detail' }, h(Badge, { state, onEnter: (_el, info, at) => host && scheduleOpen(host, info, at), onLeave: scheduleClose, onSetup: () => void sendMessage('openSettings').catch(() => {}) })), mount);

  function ensureHost(): HTMLElement {
    if (host) return host;
    host = document.createElement(tag);
    host.style.cssText = 'all: initial; ' + (place?.hostStyle ?? 'display: inline-flex; align-items: center; margin-left: 14px; vertical-align: middle;');
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
    hooks.onInfo?.(info);
  }

  return function update(): void {
    const found = place?.find(document, knownTitles);
    if (!found) {
      host?.remove();
      key = '';
      info = null;
      hooks.onInfo?.(null);
      hooks.onMissing?.();
      return;
    }
    hooks.onFound?.();
    const k = matchKey(found.query) + '@' + found.query.platformId;
    const el = ensureHost();
    // A badge laid over its anchor needs the anchor to be the box it is positioned in.
    if (/position:\s*absolute/.test(place?.hostStyle ?? '') && getComputedStyle(found.anchor).position === 'static') found.anchor.style.position = 'relative';
    if (key === k && el.parentElement === found.anchor) {
      hooks.onInfo?.(info); // the episode list changes when the season is switched
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

/** The ratings inside a site's detail screen, and each episode's rating in its episode list. */
export function createDetail(adapter: SiteAdapter) {
  let reportedFor = '';
  return createPlacement('streamrating-detail', adapter.detail, {
    onInfo: createEpisodeRatings(adapter),
    onMissing() {
      // A title id in the address but nowhere to put the chips: say what the page offers, once per address.
      const wantsDetail = /[?&]jbv=\d+|\/title\/\d+/.test(location.href) && !location.pathname.startsWith('/watch');
      if (wantsDetail && reportedFor !== location.href) {
        reportedFor = location.href;
        console.info('[StreamRating] detail screen open but ratings could not be placed. ' + JSON.stringify(describeDetail()));
      }
    },
  });
}

/** How long a page that should have a billboard may go without one before it is reported. */
const BILLBOARD_GRACE_MS = 5000;

/** The ratings for the featured title at the top of a home page, next to its Play button. */
export function createBillboard(adapter: SiteAdapter) {
  let missingSince = 0;
  let reportedFor = '';
  const beside = createPlacement('streamrating-billboard', adapter.billboard, {
    onFound: () => {
      missingSince = 0;
    },
    onMissing() {
      if (!adapter.billboard?.expected(new URL(location.href))) return;
      missingSince ||= Date.now();
      // Say once per address what the top of the page holds, so the selectors can be fixed from one pasted line.
      if (Date.now() - missingSince < BILLBOARD_GRACE_MS || reportedFor === location.href) return;
      reportedFor = location.href;
      console.info('[StreamRating] billboard not recognised. ' + JSON.stringify(describeBillboard()));
    },
  });
  // The same rating again on the billboard itself, in its corner.
  const onIt = createPlacement('streamrating-billboard-badge', adapter.billboard?.frame, {});
  return () => {
    beside();
    onIt();
  };
}
