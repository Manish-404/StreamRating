import { isRenderable } from '../content/diagnose';
import type { MatchQuery } from '../match/types';
import { parseVideoTitle } from '../match/videoTitle';
import type { SiteAdapter } from './types';

/**
 * Video tiles in the older markup (search results, the Movies & TV page) and the newer lockup (home page, the
 * list beside a playing video). A home-page grid item wraps a lockup, so only the innermost tile is used.
 */
const CARD = [
  'ytd-rich-item-renderer',
  'ytd-video-renderer',
  'ytd-grid-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-playlist-video-renderer',
  'ytd-playlist-panel-video-renderer',
  'ytd-movie-renderer',
  'ytd-grid-movie-renderer',
  'ytd-compact-movie-renderer',
  'yt-lockup-view-model',
].join(', ');
/** Films sold or rented on YouTube (the "YouTube Movies & TV" channel). Their title is the film's name. */
const MOVIE_TILE = 'ytd-movie-renderer, ytd-grid-movie-renderer, ytd-compact-movie-renderer';
const WATCH_LINK = 'a[href*="/watch?v="]';
const THUMBNAIL = 'ytd-thumbnail, yt-thumbnail-view-model, a[class*="ContentImage"], a[class*="content-image"]';
const VIDEO_ID = /[?&]v=([\w-]{11})/;
/**
 * In the newer lockup a film for sale carries the channel's name or the offer instead of a special tag.
 * The tile's parts run together in its text ("Sports 2009Buy or rent"), so no word boundaries here.
 */
const SOLD_HERE = /Buy or rent|Free with ads/i;

/**
 * An upload's title is free text ("Pushpa 2 Full Movie Hindi Dubbed | Allu Arjun"), so a weak match is more often
 * wrong than right: below this the video gets no badge at all.
 */
export const VIDEO_TITLE_MIN_CONFIDENCE = 0.8;

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function findCards(root: ParentNode): HTMLElement[] {
  const cards: HTMLElement[] = [];
  for (const card of root.querySelectorAll<HTMLElement>(CARD)) {
    if (card.querySelector(CARD)) continue; // a wrapper: its inner tile is listed too
    if (!card.querySelector(WATCH_LINK)) continue; // Shorts, channels, ads
    cards.push(card);
  }
  return cards;
}

/** The full title: the attribute holds it even where the text on screen is cut short. */
function titleOf(card: HTMLElement): string {
  for (const sel of ['#video-title[title]', 'h3[title]', 'a#video-title-link[title]']) {
    const t = clean(card.querySelector(sel)?.getAttribute('title'));
    if (t) return t;
  }
  return clean(card.querySelector('#video-title, [class*="MetadataViewModelTitle"], [class*="metadata-view-model__title"], h3')?.textContent);
}

/** The first plausible year in a tile's text other than the title ("Drama • 2023", "Sports 2009Buy or rent"). */
function yearBesides(text: string, title: string): number | undefined {
  // Found by its digits alone: a duration (2:08:29) or a view count (4.3M) is not a year.
  const m = /(?<![\d:.])((?:19|20)\d{2})(?![\d:])/.exec(text.replace(title, ' '));
  const year = Number(m?.[1]);
  return m && year <= new Date().getFullYear() + 2 ? year : undefined;
}

/** A query from an upload's title, or null when the title is not about one film. */
export function queryFromVideoTitle(title: string): MatchQuery | null {
  const reading = parseVideoTitle(title);
  const [name, ...alternatives] = reading?.candidates ?? [];
  if (!reading || !name) return null;
  return {
    title: name,
    ...(alternatives.length ? { alternatives } : {}),
    ...(reading.year !== undefined ? { year: reading.year, yearIsUpload: true } : {}),
    ...(reading.type ? { type: reading.type } : {}),
    ...(reading.people.length ? { people: reading.people } : {}),
    platform: 'youtube',
    minConfidence: VIDEO_TITLE_MIN_CONFIDENCE,
  };
}

/** A film sold on YouTube is listed by its name, sometimes with the year: "Napoleon (2023)". */
function soldFilm(title: string, year: number | undefined): MatchQuery {
  const named = /^(.+?)\s*[([]((?:19|20)\d{2})[)\]]$/.exec(title);
  const y = named ? Number(named[2]) : year;
  return { title: named?.[1] ?? title, ...(y !== undefined ? { year: y } : {}), type: 'movie', platform: 'youtube' };
}

function extract(card: HTMLElement): MatchQuery | null {
  const title = titleOf(card);
  if (!title) return null;
  const platformId = VIDEO_ID.exec(card.querySelector(WATCH_LINK)?.getAttribute('href') ?? '')?.[1];
  const text = clean(card.textContent);
  const forSale =
    card.matches(MOVIE_TILE) || SOLD_HERE.test(text.replace(title, ' ')) || !!card.querySelector('[aria-label*="YouTube Movies"]');
  if (forSale) return { ...soldFilm(title, yearBesides(text, title)), platformId };
  const query = queryFromVideoTitle(title);
  return query && { ...query, platformId };
}

const thumbnailOf = (card: HTMLElement) => card.querySelector<HTMLElement>(THUMBNAIL) ?? card;

/**
 * The watch page: the chips go on their own line under the video's title, clear of the player. The title is read
 * only once YouTube has swapped it in for the address's video (it keeps the old one for a moment after a click).
 */
function findDetail(doc: Document, known: Map<string, MatchQuery>): { query: MatchQuery; anchor: HTMLElement } | null {
  const url = new URL(doc.location.href);
  if (url.pathname !== '/watch') return null;
  const id = url.searchParams.get('v');
  if (!id) return null;
  const meta = Array.from(doc.querySelectorAll<HTMLElement>('ytd-watch-metadata')).find(isRenderable);
  if (!meta) return null;
  const shownId = meta.getAttribute('video-id');
  if (shownId && shownId !== id) return null;
  const h1 = meta.querySelector('h1');
  const title = clean(h1?.querySelector('[title]')?.getAttribute('title')) || clean(h1?.textContent);
  if (!h1?.parentElement || !title) return null;

  let query = known.get(id) ?? null;
  if (!query) {
    const channel = clean(meta.querySelector('ytd-channel-name')?.textContent);
    if (/YouTube Movies/i.test(channel)) {
      const release = /Release date\s*((?:19|20)\d{2})/i.exec(clean(doc.querySelector('ytd-metadata-row-container-renderer')?.textContent));
      query = soldFilm(title, release ? Number(release[1]) : undefined);
    } else {
      query = queryFromVideoTitle(title);
    }
  }
  if (!query) return null;
  return { query: { ...query, platformId: id }, anchor: h1.parentElement };
}

export const youtube: SiteAdapter = {
  id: 'youtube',
  platform: 'youtube',
  matches: (url) => url.hostname === 'www.youtube.com' || url.hostname === 'youtube.com',
  findCards,
  extract,
  anchor: thumbnailOf,
  // A search result is a whole row; only the picture should open the card.
  hoverTarget: thumbnailOf,
  detail: { find: findDetail, hostStyle: 'display: flex; align-items: center; margin: 8px 0 2px;' },
};
