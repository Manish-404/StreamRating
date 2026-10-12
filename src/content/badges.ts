import { h, render } from 'preact';
import { matchKey } from '../match/key';
import type { TitleInfo } from '../match/types';
import { sendMessage } from '../messaging/protocol';
import type { SiteAdapter } from '../sites/types';
import { Badge } from './Badge';
import { knownTitles } from './known';
import { scheduleClose, scheduleOpen } from './card';
import type { BadgeState } from './state';
import css from './ui.css?inline';

interface Entry {
  key: string;
  host: HTMLElement;
  mount: HTMLElement;
  anchor: HTMLElement;
  card: HTMLElement;
  state: BadgeState;
}

/** Puts a rating badge on thumbnails and keeps it right while the site recycles its elements. */
export function createBadges(adapter: SiteAdapter) {
  const entries = new WeakMap<HTMLElement, Entry>();
  const hoverTarget = (card: HTMLElement) => adapter.hoverTarget?.(card) ?? card;

  const keyFor = (card: HTMLElement) => {
    const query = adapter.extract(card);
    return query ? { query, key: matchKey(query) + '@' + (query.platformId ?? '') } : null;
  };

  const paint = (e: Entry) =>
    render(
      h(Badge, {
        state: e.state,
        onEnter: (_el: HTMLElement, info: TitleInfo, at) => scheduleOpen(hoverTarget(e.card), info, at),
        onLeave: scheduleClose,
        onSetup: () => void sendMessage('openSettings').catch(() => {}),
      }),
      e.mount,
    );

  function attach(e: Entry): void {
    if (getComputedStyle(e.anchor).position === 'static') e.anchor.style.position = 'relative';
    e.anchor.append(e.host);
  }

  function create(card: HTMLElement, anchor: HTMLElement, key: string): Entry {
    const host = document.createElement('streamrating-badge');
    host.style.cssText = 'all: initial; position: absolute; top: 6px; left: 6px; z-index: 20; pointer-events: none;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    const mount = document.createElement('div');
    shadow.append(style, mount);
    const entry: Entry = { key, host, mount, anchor, card, state: { status: 'loading' } };
    attach(entry);
    return entry;
  }

  async function load(entry: Entry, card: HTMLElement, query: Parameters<typeof sendMessage<'lookupTitle'>>[1]) {
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
      next = { status: 'none' }; // the extension was reloaded under this page
    }
    // The site may have reused this card for another title while we waited.
    if (entries.get(card) !== entry) return;
    entry.state = next;
    paint(entry);
  }

  const hoverWatched = new WeakSet<HTMLElement>();

  /** Hovering the thumbnail itself opens the card, whatever the site shows on top of it afterwards. */
  function watchHover(card: HTMLElement): void {
    const target = hoverTarget(card);
    if (hoverWatched.has(target)) return;
    hoverWatched.add(target);
    target.addEventListener('mouseenter', (e) => {
      const state = entries.get(card)?.state;
      if (state?.status === 'ready') scheduleOpen(target, state.info, { x: e.clientX, y: e.clientY });
    });
    target.addEventListener('mouseleave', scheduleClose);
  }

  /** Safe to call as often as you like: it does nothing when the card already shows the right badge. */
  return function visit(card: HTMLElement): void {
    const found = keyFor(card);
    const existing = entries.get(card);
    if (!found) {
      existing?.host.remove();
      entries.delete(card);
      return;
    }

    if (found.query.platformId) knownTitles.set(found.query.platformId, found.query);
    const anchor = adapter.anchor(card);
    if (existing && existing.key === found.key) {
      watchHover(card); // the site may have swapped the thumbnail inside a card it kept
      if (existing.host.parentElement !== anchor) {
        existing.anchor = anchor;
        attach(existing);
      }
      return;
    }

    existing?.host.remove();
    const entry = create(card, anchor, found.key);
    entries.set(card, entry);
    watchHover(card);
    paint(entry);
    void load(entry, card, found.query);
  };
}
