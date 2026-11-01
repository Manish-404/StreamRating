import type { MatchQuery } from '../match/types';
import type { NowPlaying, SiteAdapter } from './types';

const WATCH = /^\/watch\/(\d+)/;

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** "S2:E3", "S2 E3", "Season 2: Episode 3". */
const SEASON_EPISODE = /\bS(?:eason)?\s*(\d+)\s*[:,]?\s*E(?:p(?:isode)?\.?)?\s*(\d+)\b/i;
/** "E3", "Ep. 3", "Episode 3": a series with one season leaves the season out. */
const EPISODE_ONLY = /^(?:E|Ep\.?|Episode)\s*(\d+)$/i;

/**
 * The player's title line (`data-uia="video-title"`): the series' name, then a marker such as "S2:E3", then the
 * episode's name. A film has just its name. Netflix removes the line when the controls hide, so null here is normal.
 */
function readTitleLine(box: Element): { name: string; season?: number; episode?: number } | null {
  const pieces = Array.from(box.querySelectorAll('h1, h2, h3, h4, span, div, p'))
    .filter((el) => el.childElementCount === 0)
    .map((el) => clean(el.textContent))
    .filter(Boolean);
  if (pieces.length === 0) pieces.push(clean(box.textContent));

  let season: number | undefined;
  let episode: number | undefined;
  let marker = -1;
  pieces.forEach((p, i) => {
    if (marker >= 0) return;
    const both = SEASON_EPISODE.exec(p);
    const only = EPISODE_ONLY.exec(p);
    if (both) [season, episode, marker] = [Number(both[1]), Number(both[2]), i];
    else if (only) [season, episode, marker] = [1, Number(only[1]), i];
  });

  const heading = clean(box.querySelector('h1, h2, h3, h4')?.textContent);
  const name = heading || pieces.find((_, i) => i !== marker) || '';
  if (!name) return null;
  return { name, ...(episode !== undefined ? { season, episode } : {}) };
}

function nowPlaying(doc: Document, known: Map<string, MatchQuery>): NowPlaying | null {
  const id = WATCH.exec(new URL(doc.location.href).pathname)?.[1];
  if (!id) return null;
  const line = Array.from(doc.querySelectorAll('[data-uia="video-title"]'))
    .map(readTitleLine)
    .find(Boolean);
  const seen = known.get(id);
  if (!line) return seen ? { id, query: { ...seen, platform: 'netflix', platformId: id } } : null;
  const isSeries = line.episode !== undefined;
  const query: MatchQuery = {
    ...(seen && !isSeries ? seen : {}),
    title: line.name,
    platform: 'netflix',
    platformId: id,
    ...(isSeries ? { type: 'tv' as const } : {}),
  };
  return { id, query, ...(isSeries ? { season: line.season, episode: line.episode } : {}) };
}

export const netflixPlayer: NonNullable<SiteAdapter['player']> = {
  isPlayerPage: (url) => WATCH.test(url.pathname),
  nowPlaying,
  reportUnreadable: true,
};
