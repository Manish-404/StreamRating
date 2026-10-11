import { isRenderable } from '../content/diagnose';
import type { MatchQuery } from '../match/types';
import { findNetflixEpisodes } from './netflixEpisodes';
import type { SiteAdapter } from './types';

// Netflix ids appear as /watch/<id>, /title/<id>, or (current browse pages) /browse?jbv=<id>.
const TITLE_ID = /(?:\/(?:watch|title)\/|[?&]jbv=)(\d+)/;
const TITLE_LINK = 'a[data-uia="standard-card"], a[href*="/watch/"], a[href*="/title/"], a[href*="jbv="]';

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Netflix class names change often (the current ones are generated, like default-ltr-xxxx-cache-yyyy), so
 * thumbnails are found two ways: the classic `.title-card` wrapper, and any title link that holds an image
 * (`a[data-uia="standard-card"]`, or a link to a watch, title or jbv= address).
 * A link inside a `.title-card` is not counted twice.
 */
function findCards(root: ParentNode): HTMLElement[] {
  const cards = Array.from(root.querySelectorAll<HTMLElement>('.title-card'));
  for (const link of root.querySelectorAll<HTMLElement>(TITLE_LINK)) {
    if (link.closest('.title-card')) continue;
    if (link.closest('[data-uia="video-title"], [data-uia="player"], .watch-video')) continue;
    if (!link.querySelector('img')) continue;
    cards.push(link);
  }
  return cards;
}

function extract(card: HTMLElement) {
  const link = card.matches(TITLE_LINK) ? (card as HTMLAnchorElement) : card.querySelector<HTMLAnchorElement>(TITLE_LINK);
  const title =
    clean(link?.getAttribute('aria-label')) ||
    clean(link?.getAttribute('title')) ||
    clean(card.querySelector('.fallback-text')?.textContent) ||
    clean(card.querySelector('img')?.getAttribute('alt'));
  if (!title) return null;
  const platformId = link ? TITLE_ID.exec(link.getAttribute('href') ?? '')?.[1] : undefined;
  return { title, platform: 'netflix' as const, platformId };
}

/**
 * The more-info modal. The address carries the title id (/browse?jbv=<id> or /title/<id>); the name comes from
 * the thumbnail that was clicked, or failing that from the title logo image inside the dialog.
 * The chips go into the row that holds the Play button, so nothing is drawn over the artwork or the text.
 */
function findDetail(doc: Document, known: Map<string, MatchQuery>): { query: MatchQuery; anchor: HTMLElement } | null {
  const url = new URL(doc.location.href);
  if (url.pathname.startsWith('/watch')) return null; // never touch the video player
  const id = url.searchParams.get('jbv') ?? /^\/title\/(\d+)/.exec(url.pathname)?.[1];
  if (!id) return null;
  const play = Array.from(doc.querySelectorAll<HTMLElement>('[data-uia="play-button"]')).find(isRenderable);
  const anchor = play?.parentElement;
  if (!anchor) return null;
  let query = known.get(id);
  if (!query) {
    const logo = Array.from(doc.querySelectorAll<HTMLImageElement>('[role="dialog"] img[alt]')).find((i) => clean(i.alt) && isRenderable(i));
    if (!logo) return null;
    query = { title: clean(logo.alt), platform: 'netflix' };
  }
  return { query: { ...query, platformId: id }, anchor };
}

export const netflix: SiteAdapter = {
  id: 'netflix',
  platform: 'netflix',
  matches: (url) => /(^|\.)netflix\.com$/.test(url.hostname),
  findCards,
  extract,
  // A thumbnail that is itself the link holds the badge directly; the classic layout has a boxart container.
  detail: { find: findDetail },
  episodes: { find: findNetflixEpisodes },
  anchor: (card) => card.querySelector<HTMLElement>('.boxart-container') ?? card,
};
