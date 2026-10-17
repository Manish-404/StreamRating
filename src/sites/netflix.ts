import { isRenderable } from '../content/diagnose';
import type { MatchQuery } from '../match/types';
import { findNetflixEpisodes } from './netflixEpisodes';
import type { SiteAdapter } from './types';

// Netflix ids appear as /watch/<id>, /title/<id>, or (current browse pages) /browse?jbv=<id>.
const TITLE_ID = /(?:\/(?:watch|title)\/|[?&]jbv=)(\d+)/;
const TITLE_LINK = 'a[data-uia="standard-card"], a[href*="/watch/"], a[href*="/title/"], a[href*="jbv="]';

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const PLAY = '[data-uia="play-button"]';
/** Not the billboard: the title dialog, and the small preview that opens over a hovered thumbnail. */
const OVERLAY = '[role="dialog"], [class*="previewModal"]';

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
  for (const card of moreLikeThisCards(root)) if (!cards.includes(card)) cards.push(card);
  return cards;
}

/** The "More Like This" tiles in a title dialog, by the names Netflix gives them (not confirmed on the live site). */
const MORE_LIKE_CARD = '[data-uia="titleCard--container"], [class*="titleCard--container"], [data-uia*="more-like-this" i] [data-uia*="card" i]';

/** The first element whose own text is exactly `text`. */
function elementWithText(scope: HTMLElement, text: RegExp): Element | null {
  const walker = scope.ownerDocument.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (text.test(clean(n.textContent))) return n.parentElement;
  return null;
}

/**
 * The tiles under "More Like This" in a title dialog. They are not links, so they are found by name when Netflix
 * names them, and otherwise as every picture that follows the "More Like This" heading (the episode list, whose
 * pictures come before it, is left alone), each grown to the largest box that still holds only that picture.
 */
function moreLikeThisCards(root: ParentNode): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const dialog of root.querySelectorAll<HTMLElement>('[role="dialog"]')) {
    const named = dialog.querySelectorAll<HTMLElement>(MORE_LIKE_CARD);
    if (named.length) {
      found.push(...named);
      continue;
    }
    const header = elementWithText(dialog, /^more like this$/i);
    if (!header) continue;
    for (const img of dialog.querySelectorAll('img')) {
      if (!(header.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING) || header.contains(img)) continue;
      if (img.closest(TITLE_LINK + ', .title-card')) continue; // an ordinary thumbnail, already found
      let card: HTMLElement = img;
      for (let depth = 0; depth < 5; depth++) {
        const up = card.parentElement;
        if (!up || up === dialog || up.contains(header) || up.querySelectorAll('img').length !== 1) break;
        card = up;
      }
      if (!found.includes(card)) found.push(card);
    }
  }
  return found;
}

function extract(card: HTMLElement) {
  const link = card.matches(TITLE_LINK) ? (card as HTMLAnchorElement) : card.querySelector<HTMLAnchorElement>(TITLE_LINK);
  const title =
    clean(link?.getAttribute('aria-label')) ||
    clean(link?.getAttribute('title')) ||
    clean(card.querySelector('.fallback-text')?.textContent) ||
    clean(card.querySelector('img')?.getAttribute('alt')) ||
    // A "More Like This" tile is not a link: its name is on the tile itself or in a title-like element inside it.
    asName(card.getAttribute('aria-label')) ||
    asName(card.querySelector('[class*="title" i]:not([class*="titleCard--container"]), [data-uia*="title" i]')?.textContent);
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
  // The billboard behind the dialog has a Play button too, and comes first in the page.
  const plays = Array.from(doc.querySelectorAll<HTMLElement>(PLAY)).filter(isRenderable);
  const play = plays.find((b) => b.closest(OVERLAY)) ?? (url.pathname.startsWith('/title/') ? plays[0] : undefined);
  const anchor = play?.parentElement;
  if (!anchor) return null;
  let query = known.get(id);
  if (!query) {
    const dialog = doc.querySelector<HTMLElement>('[role="dialog"]');
    const logo = Array.from(doc.querySelectorAll<HTMLImageElement>('[role="dialog"] img[alt]')).find((i) => asName(i.alt) && isRenderable(i));
    // A dialog opened from the billboard has no thumbnail to name it: use the billboard title that was just clicked.
    const clicked = Date.now() - clickedTitle.at < 15000 ? clickedTitle.title : '';
    const title = (logo && asName(logo.alt)) || asName(dialog?.getAttribute('aria-label')) || clicked;
    if (!title) return null;
    query = { title, platform: 'netflix' };
  }
  return { query: { ...query, platformId: id }, anchor };
}

/** Home and genre pages carry a billboard; My List and the player do not. */
const hasBillboard = (url: URL) => (url.pathname === '/browse' || url.pathname.startsWith('/browse/')) && !url.pathname.startsWith('/browse/my-list');

/** Words on Netflix's own pictures and badges, never a title's name. */
const NOT_A_NAME = /^(?:netflix|n|top 10|new|recently added|play|more info|u\/a.*|tv-.*|pg.*|r|a|\d+\+)$/i;

/** A name read from an attribute or a short piece of text, or '' when it is empty or one of Netflix's own words. */
const asName = (s: string | null | undefined) => {
  const t = clean(s);
  return t.length >= 1 && t.length <= 80 && !NOT_A_NAME.test(t) ? t : '';
};

/**
 * The featured title's name, looked for around the Play button's row and further out, but never so far out that the
 * rows of thumbnails (other titles' names) are included: a picture's alt or title text (the logo or the backdrop),
 * then a heading, then a label such as "Play Squid Game".
 */
function billboardName(row: HTMLElement, play: HTMLElement): string {
  const label = /^play\s+(.+)/i.exec(clean(play.getAttribute('aria-label')))?.[1];
  for (let box: HTMLElement | null = row, depth = 0; box && box !== row.ownerDocument.body && depth < 8; box = box.parentElement, depth++) {
    if (box.querySelector('a[data-uia="standard-card"], .title-card')) break;
    for (const img of box.querySelectorAll('img')) {
      const name = asName(img.getAttribute('alt')) || asName(img.getAttribute('title'));
      if (name) return name;
    }
    for (const el of box.querySelectorAll('h1, h2, h3, [role="heading"], [class*="title" i]')) {
      const name = asName(el.textContent);
      if (name) return name;
    }
    if (label) return asName(label);
  }
  return label ? asName(label) : '';
}

/**
 * The billboard by Netflix's own names (seen on the live site): data-uia billboard, with billboard-actions holding
 * Play (play-video-button) and billboard-more-info, and billboard-logo / billboard-title holding the name.
 */
function findNamedBillboard(doc: Document, known: Map<string, MatchQuery>): { query: MatchQuery; anchor: HTMLElement } | null {
  const box = Array.from(doc.querySelectorAll<HTMLElement>('[data-uia="billboard"]')).find(isRenderable);
  const row = box?.querySelector<HTMLElement>('[data-uia="billboard-actions"]');
  if (!box || !row) return null;
  const href = row.querySelector('a[href*="/watch/"], a[href*="/title/"], a[href*="jbv="]')?.getAttribute('href') ?? '';
  const id = TITLE_ID.exec(href)?.[1];
  const seen = id ? known.get(id) : undefined;
  let title = seen?.title ?? '';
  for (const part of box.querySelectorAll('[data-uia="billboard-logo"], [data-uia="billboard-title"]')) {
    if (title) break;
    title =
      asName(part.getAttribute('aria-label')) ||
      asName(part.getAttribute('alt')) ||
      asName(part.getAttribute('title')) ||
      asName(part.querySelector('img')?.getAttribute('alt')) ||
      asName(part.querySelector('[aria-label]')?.getAttribute('aria-label')) ||
      asName(part.textContent);
  }
  title ||= asName(box.querySelector('[data-uia="billboard-background-media+image"]')?.getAttribute('alt'));
  // "Play Black Adam", "More info about Black Adam": a label on the buttons or any element of the billboard.
  for (const el of box.querySelectorAll('[aria-label], [title]')) {
    if (title) break;
    const m = /^(?:play|more info(?: about| on| for)?|watch)\s+(.+)$/i.exec(clean(el.getAttribute('aria-label') ?? el.getAttribute('title')));
    title = asName(m?.[1]);
  }
  if (!title) return null;
  const query: MatchQuery = { ...(seen ?? {}), title, platform: 'netflix', ...(id ? { platformId: id } : {}) };
  if (id && !known.has(id)) known.set(id, query);
  return { query, anchor: row };
}

/**
 * The billboard: the big featured title at the top of a home or genre page, a different one on each load. Its Play
 * button is the only one on the page outside the title dialog and the small preview over a hovered thumbnail. The
 * chips go into the row that holds Play and More Info, so nothing is drawn over the trailer. The name comes from the
 * thumbnail of the same title when the billboard links to one, otherwise from the billboard itself.
 */
function findBillboard(doc: Document, known: Map<string, MatchQuery>): { query: MatchQuery; anchor: HTMLElement } | null {
  if (!hasBillboard(new URL(doc.location.href))) return null;
  const named = findNamedBillboard(doc, known);
  if (named) return named;
  const candidates = [
    ...doc.querySelectorAll<HTMLElement>(PLAY),
    // In case a redesign drops data-uia: a button whose whole text is "Play".
    ...Array.from(doc.querySelectorAll<HTMLElement>('button')).filter((b) => /^play$/i.test(clean(b.textContent))),
  ];
  const play = candidates.find((b) => isRenderable(b) && !b.closest(OVERLAY));
  if (!play) return null;
  // The classic layout wraps the Play button in a link to the player, and that link sits in the row.
  const button = play.closest<HTMLElement>('a[href*="/watch/"]') ?? play;
  const row = button.parentElement;
  if (!row) return null;
  const href = button.getAttribute('href') ?? row.querySelector('a[href*="/watch/"], a[href*="/title/"], a[href*="jbv="]')?.getAttribute('href') ?? '';
  const id = TITLE_ID.exec(href)?.[1];
  const seen = id ? known.get(id) : undefined;
  const title = seen?.title || billboardName(row, play);
  if (!title) return null;
  const query: MatchQuery = { ...(seen ?? {}), title, platform: 'netflix', ...(id ? { platformId: id } : {}) };
  // The More Info dialog for this title needs its name: it may carry no picture text of its own.
  if (id && !known.has(id)) known.set(id, query);
  return { query, anchor: row };
}

/** The billboard's own box: the section that holds the Play row (the whole featured area), else a few levels up. */
function findBillboardFrame(doc: Document, known: Map<string, MatchQuery>): { query: MatchQuery; anchor: HTMLElement } | null {
  const found = findBillboard(doc, known);
  if (!found) return null;
  const named = found.anchor.closest<HTMLElement>('[data-uia="billboard"]');
  if (named) return { query: found.query, anchor: named };
  let frame = found.anchor.closest<HTMLElement>('section');
  // The outermost section that is not a row of thumbnails: the featured area is the first of them.
  for (let up = frame?.parentElement?.closest<HTMLElement>('section') ?? null; up && !up.querySelector('a[data-uia="standard-card"], .title-card'); up = up.parentElement?.closest<HTMLElement>('section') ?? null) frame = up;
  frame ??= found.anchor.parentElement?.parentElement ?? found.anchor;
  return { query: found.query, anchor: frame };
}

/** The billboard title behind the last click on the billboard (its More Info or Play), for the dialog that opens. */
const clickedTitle = { title: '', at: 0 };
if (typeof document !== 'undefined') {
  document.addEventListener(
    'click',
    (e) => {
      const hit = (e.target as Element | null)?.closest?.('[data-uia="billboard"]');
      if (!hit) return;
      const found = findBillboard(document, new Map());
      if (found) Object.assign(clickedTitle, { title: found.query.title, at: Date.now() });
    },
    { capture: true, passive: true },
  );
}

export const netflix: SiteAdapter = {
  id: 'netflix',
  platform: 'netflix',
  matches: (url) => /(^|\.)netflix\.com$/.test(url.hostname),
  findCards,
  extract,
  // A thumbnail that is itself the link holds the badge directly; the classic layout has a boxart container.
  detail: { find: findDetail },
  billboard: {
    find: findBillboard,
    expected: hasBillboard,
    // Below the top menu, at the left edge where the title logo is, so it reads as part of the title.
    frame: { find: findBillboardFrame, hostStyle: 'position: absolute; left: 4%; top: 84px; z-index: 5;' },
  },
  episodes: { find: findNetflixEpisodes },
  anchor: (card) => card.querySelector<HTMLElement>('.boxart-container') ?? card,
};
