import type { MediaType } from '../db/types';

/** Lower-case, accent-free, punctuation-free form used to compare titles. Works for any script. */
export function normalizeTitle(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export interface ParsedName {
  title: string;
  year?: number;
  season?: number;
  episode?: number;
  type?: MediaType;
}

const QUALITY =
  /\b(?:480p|576p|720p|1080p|1440p|2160p|4k|uhd|blu-?ray|brrip|bdrip|bdremux|remux|web-?dl|webrip|web|hdrip|hdtv|dvdrip|dvdscr|hdcam|hdts|cam|x264|x265|h\.?264|h\.?265|hevc|avc|aac|ddp?5\.?1|atmos|10bit|amzn|nf|dsnp|hmax|hulu|proper|repack|extended|unrated|imax|complete|multi|dual[ -]audio)\b/i;

const EPISODE_CODE = /\bS(\d{1,2})[ ._-]?E(\d{1,3})\b/i;
const EPISODE_X = /\b(\d{1,2})x(\d{2,3})\b/i;
const SEASON_WORD = /\bSeason[ ._-]?(\d{1,2})\b/i;
const SEASON_ONLY = /\bS(\d{1,2})\b(?![ ._-]?E\d)/i;
const BRACKETED_YEAR = /[([]((?:19|20)\d{2})[)\]]/;
const BARE_YEAR = /\b((?:19|20)\d{2})\b/g;

/**
 * Pulls a title, year and season/episode out of a release name or a video title, for example
 * "The.Boys.S03E05.1080p.WEB.H264-GLHF" or "[YTS.MX] Oppenheimer (2023) [1080p]".
 */
export function parseReleaseName(raw: string): ParsedName {
  let s = raw.trim();
  s = s.replace(/^\s*\[[^\]]*\]\s*/, '').replace(/^\s*www\.\S+\s*[-:]\s*/i, '');
  // Dots or underscores used as spaces: "Dune.Part.Two.2024"
  if (!/\s/.test(s) || (s.match(/[._]/g)?.length ?? 0) > (s.match(/\s/g)?.length ?? 0)) {
    s = s.replace(/[._]+/g, ' ');
  }

  let season: number | undefined;
  let episode: number | undefined;
  let seIndex = Infinity;
  const code = EPISODE_CODE.exec(s) ?? EPISODE_X.exec(s);
  if (code) {
    season = Number(code[1]);
    episode = Number(code[2]);
    seIndex = code.index;
  } else {
    const word = SEASON_WORD.exec(s) ?? SEASON_ONLY.exec(s);
    if (word) {
      season = Number(word[1]);
      seIndex = word.index;
    }
  }

  const qualityIndex = QUALITY.exec(s)?.index ?? Infinity;

  // A year in brackets is certain; otherwise take the last bare year that is not the first word,
  // so "Blade Runner 2049 (2017)" and "2001 A Space Odyssey 1968" both come out right.
  let year: number | undefined;
  let yearIndex = Infinity;
  const bracketed = BRACKETED_YEAR.exec(s);
  if (bracketed) {
    year = Number(bracketed[1]);
    yearIndex = bracketed.index;
  } else {
    for (const m of s.matchAll(BARE_YEAR)) {
      if (m.index > 0 && m.index < Math.min(qualityIndex, seIndex)) {
        year = Number(m[1]);
        yearIndex = m.index;
      }
    }
  }

  const end = Math.min(yearIndex, seIndex, qualityIndex, s.length);
  const title = s
    .slice(0, end)
    .replace(/[\s\-:([]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  const type: MediaType | undefined = season !== undefined ? 'tv' : year !== undefined ? 'movie' : undefined;
  return { title, year, season, episode, type };
}
