import type { MediaType } from '../db/types';
import { normalizeTitle } from './parseTitle';

export interface VideoTitleReading {
  /** Likely names of the film, best guess first. Each is searched until one matches a real title exactly. */
  candidates: string[];
  year?: number;
  type?: MediaType;
  /** Names of people listed in the title (cast, director), used to tell same-named films apart and to find re-titled dubs. */
  people: string[];
}

/** Only titles that say they are about a film are read: "Full Movie", "Movie Review", "Official Trailer", "फिल्म". */
const ABOUT_A_FILM = /\b(?:movies?|films?|trailers?|teasers?)\b|फ़िल्म|फिल्म|मूवी/i;

/** A round-up names many films or none: "Top 10 Horror Movies", "5 Best Films of 2024", "Movies like Interstellar". */
const ROUND_UP =
  /\btop\s*\d+\b|\b\d+\s+(?:best|worst|greatest|underrated|must|upcoming|movies|films)\b|\b(?:best|worst|greatest|upcoming|new|latest|all)\s+(?:[\w-]+\s+){0,3}(?:movies|films|trailers)\b|\b(?:movies|films)\s+(?:like|of|to|that|you|ranked|ever|in\s+\d{4})\b|\branking\b|\branked\b|\bcompilation\b/i;

const TV = /\b(?:season\s*\d+|S\d{1,2}(?:\s*E\d{1,3})?|episodes?\s*\d*|web\s*series|tv\s*series|series)\b/i;
const MOVIE = /\b(?:movies?|films?)\b|फ़िल्म|फिल्म|मूवी/i;

/**
 * Pieces of an upload title: "Oppenheimer (2023) | HD Full Movie | Universal Studios". A hyphen only counts with spaces round it.
 * Dubbing channels often type a capital I (or the Devanagari danda) where others type a pipe: "SAMRAJYA Full Movie I Vijay Deverakonda".
 */
const SEPARATORS = /\s*(?:\|+|｜|•|·|\/\/|\s[-–—~]\s|\s[I।]\s)\s*/;

const LANG = 'hindi|tamil|telugu|malayalam|kannada|bengali|bangla|marathi|punjabi|gujarati|bhojpuri|urdu|odia|english|korean|japanese|chinese|spanish';
// A language name is part of a title ("English Vinglish", "The English Patient") unless a word like these follows it.
const AFTER_LANG = 'dubbed|dub|movies?|films?|version|trailers?|teasers?|audio|explained|explanation|explain|review|full|subs?|subtitles?|songs?';

/** Where the film's name ends: the first of these that is not at the very start of a piece. */
const MARKER = new RegExp(
  [
    '\\bofficial\\b',
    '\\bnew\\s+releas(?:e|ed)\\b',
    '\\bfull\\s+(?:movie|film|hd|video|length)\\b',
    '\\bending\\s+explained\\b',
    '\\b(?:movie|film)s?\\b',
    'फ़िल्म|फिल्म|मूवी',
    '\\b(?:trailer|teaser|glimpse|promo|recap|reaction|breakdown|review|explained|explanation|explain|summary|summari[sz]ed|jukebox|lyrical)s?\\b',
    '\\b(?:' + LANG + ')(?=\\s+(?:' + AFTER_LANG + ')\\b|\\s*$)',
    '\\bin\\s+(?:' + LANG + ')\\b',
    '\\bdubbed\\b',
    '\\b(?:hd|fhd|uhd|hdr|4k|8k|imax|1080p|720p|480p)\\b',
    '\\bfirst\\s+look\\b',
    '\\bmotion\\s+poster\\b',
    '\\bbox\\s+office\\b',
    '\\bbehind\\s+the\\s+scenes\\b',
    '\\bmaking\\s+of\\b',
    '\\bseason\\s*\\d+',
    '\\bS\\d{1,2}(?:\\s*E\\d{1,3})?\\b',
    '\\bepisode\\s*\\d+',
    '\\b(?:scene|clip|song)s?\\b',
    '[(\\[{【]',
  ].join('|'),
  'i',
);

/** Words that do not name a film on their own. A candidate made only of these is dropped. */
const GENERIC = new Set(
  (
    'the a an of in on and with for to my your part chapter vol volume ' +
    'new latest old classic superhit super hit hits blockbuster best top released release upcoming exclusive world premiere tv ' +
    'south north indian india hollywood bollywood tollywood kollywood mollywood sandalwood desi korean chinese japanese ' +
    LANG.replace(/\|/g, ' ') +
    ' action comedy romantic romance drama horror thriller crime family emotional suspense mystery patriotic sci fi scifi ' +
    'fantasy adventure war animated animation kids cartoon full hd official dubbed dub movie movies film films trailer trailers ' +
    'teaser free watch online version story'
  ).split(/\s+/),
);

/** Left over at the end of a name after the cut: "Pushpa 2 New" (from "Pushpa 2 New Hindi Dubbed Movie"). */
const TRAILING_NOISE = new Set(
  ('new latest superhit blockbuster south indian hollywood bollywood tollywood kollywood full hd official dubbed ' + LANG.replace(/\|/g, ' ')).split(
    /\s+/,
  ),
);

const MAX_CANDIDATES = 4;
const MAX_PEOPLE = 5;

/** Words that make a piece a channel or studio, not a person: "Universal Studios", "Goldmines Telefilms". */
const CHANNEL_WORDS = new Set(
  'studios studio pictures entertainment entertainments productions production films film movies music network channel official records originals telefilms media tv'.split(' '),
);

/** Where a list of names ends and the upload's tags begin: "Vijay Sethupathi Latest South Action". */
const PEOPLE_NOISE = new RegExp(
  '\\b(?:new|latest|superhit|super|blockbuster|south|north|indian|hindi|dubbed|action|comedy|thriller|romantic|horror|drama|full|hd|movie|film)s?\\b|\\d',
  'i',
);

function validYear(n: number): boolean {
  return n >= 1900 && n <= new Date().getFullYear() + 2;
}

/** A year in brackets, or failing that the last bare year that is not the first word ("2012 Full Movie" names a film). */
function yearIn(piece: string): number | undefined {
  for (const m of piece.matchAll(/[([{]\s*((?:19|20)\d{2})\s*[)\]}]/g)) {
    if (validYear(Number(m[1]))) return Number(m[1]);
  }
  let year: number | undefined;
  for (const m of piece.matchAll(/\b((?:19|20)\d{2})\b/g)) {
    if (m.index > 0 && validYear(Number(m[1]))) year = Number(m[1]);
  }
  return year;
}

/** True when no word names anything: "New South", "Part 2". A number on its own is a name ("1917", "2012"). */
const isGeneric = (s: string) => {
  const words = normalizeTitle(s).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  return words.every((w) => GENERIC.has(w) || /^\d+$/.test(w)) && words.some((w) => GENERIC.has(w));
};

function tidy(s: string): string {
  let out = s.replace(/[\s\-–—:;,.!?'"&+|/\\]+$/u, '').replace(/^[\s\-–—:;,.!?'"&+|/\\]+/u, '').replace(/\s+/g, ' ').trim();
  // A trailing release year belongs to the name's piece, not the name: "Interstellar 2014".
  const year = /\s((?:19|20)\d{2})$/.exec(out);
  if (year && validYear(Number(year[1]))) out = out.slice(0, year.index).trim();
  for (;;) {
    const words = out.split(' ');
    if (words.length < 2 || !TRAILING_NOISE.has(normalizeTitle(words[words.length - 1] ?? ''))) break;
    out = words.slice(0, -1).join(' ').replace(/[\s\-–—:;,.!?'"&+|/\\]+$/u, '');
  }
  return out;
}

/** Removes a marker or a bracketed part at the start of a piece: "Official Hindi Trailer", "[4K] Interstellar". */
function stripLeading(piece: string): string {
  let s = piece.trim();
  for (let guard = 0; guard < 12 && s; guard++) {
    const bracket = /^[([{【][^)\]}】]*[)\]}】]?\s*/.exec(s);
    if (bracket) {
      s = s.slice(bracket[0].length);
      continue;
    }
    const m = MARKER.exec(s);
    if (!m || m.index !== 0 || /^[([{【]/.test(m[0])) break;
    // "Trailer 3", "Season 2": the number belongs to the marker.
    s = s.slice(m[0].length).replace(/^[\s\-–—:;,.!?|]+/, '').replace(/^\d{1,2}\b[\s\-–—:;,.!?|]*/, '');
  }
  return s;
}

/** The names one piece could hold, best guess first. */
function readingsOf(rawPiece: string): string[] {
  const piece = stripLeading(rawPiece);
  if (!piece) return [];
  const m = MARKER.exec(piece);
  const before = tidy(m ? piece.slice(0, m.index) : piece);
  if (!before || before.length < 2 || isGeneric(before) || before.split(' ').length > 10) return [];

  const out: string[] = [];
  // "The LEGO Movie", "Scary Movie": the word may be part of the name, so try it with the word first.
  if (m && /^(?:movie|film)$/i.test(m[0])) out.push(before + ' ' + m[0]);
  out.push(before);
  // "Uri: The Surgical Strike" may be listed as "Uri".
  const colon = before.indexOf(':');
  if (colon > 1 && !isGeneric(before.slice(0, colon))) out.push(before.slice(0, colon).trim());
  // "Don Lee's THE ROUNDUP": the film is "The Roundup". A one-word rest must be long ("Schindler's List" is not "List").
  const rest = /^[\p{L}.\s]+?['’]s\s+(.+)$/u.exec(before)?.[1];
  if (rest && rest.length >= 5 && !isGeneric(rest)) out.push(rest.trim());
  return out;
}

/** Names in one piece: "Allu Arjun, Rashmika", "Prabhas & Nandita Swetha New Movie". Empty when the piece is something else. */
function peopleIn(piece: string): string[] {
  const cut = PEOPLE_NOISE.exec(piece);
  const list = cut && cut.index > 0 ? piece.slice(0, cut.index) : cut ? '' : piece;
  const out: string[] = [];
  for (const raw of list.split(/\s*(?:,|&|\band\b|\+|\sx\s)\s*/i)) {
    const name = raw.replace(/[\s\-–—:;.!?'"]+$/u, '').trim();
    const words = name.split(/\s+/);
    if (!name || words.length > 4 || /[^\p{L}\p{M}.'’\s-]/u.test(name) || isGeneric(name) || MARKER.test(name)) continue;
    // A name starts with a capital: "Vijay Deverakonda", "Jr.NTR". Lower-case words are prose.
    if (words.some((w) => !/^[\p{Lu}]/u.test(w) || CHANNEL_WORDS.has(normalizeTitle(w)))) continue;
    out.push(name);
  }
  return out;
}

/**
 * Reads a YouTube video title that is about a film, such as "Pushpa 2 The Rule Full Movie Hindi Dubbed | Allu Arjun"
 * or "OPPENHEIMER | Official Trailer". Returns null for any other video, and for round-ups that name many films.
 */
export function parseVideoTitle(raw: string): VideoTitleReading | null {
  const title = raw
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!ABOUT_A_FILM.test(title)) return null;

  const pieces = title.split(SEPARATORS).filter((p) => p.trim());
  if (pieces.length === 0 || ROUND_UP.test(pieces[0] ?? '')) return null;
  const key = Math.max(0, pieces.findIndex((p) => ABOUT_A_FILM.test(p)));

  const candidates: string[] = [];
  const seen = new Set<string>();
  let year: number | undefined;
  let nameFrom = -1;
  const readPiece = (i: number) => {
    const piece = pieces[i];
    // A cast list ("Allu Arjun, Rashmika") or a round-up after the first piece names no single film.
    if (piece === undefined || (i > 0 && (piece.includes(',') || piece.includes(' & ') || ROUND_UP.test(piece)))) return;
    for (const c of readingsOf(piece)) {
      const n = normalizeTitle(c);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      candidates.push(c);
      if (candidates.length === 1) {
        year = yearIn(piece);
        nameFrom = i;
      }
    }
  };
  // Upload titles nearly always start with the film's name; failing that it sits in or just before the piece that
  // says "movie". The piece after it is usually the channel ("| Full Movie | Universal Studios"), so it is a last resort.
  for (const i of new Set([0, key, key - 1])) readPiece(i);
  if (candidates.length === 0) readPiece(key + 1);
  if (candidates.length === 0) return null;

  // Cast and crew sit in the pieces after the name: "| Vijay Deverakonda | Sreeleela |".
  const people: string[] = [];
  for (let i = 0; i < pieces.length; i++) {
    if (i === nameFrom) continue;
    for (const name of peopleIn(pieces[i] ?? '')) {
      if (!people.includes(name) && !candidates.includes(name)) people.push(name);
    }
  }

  const type: MediaType | undefined = TV.test(title) ? 'tv' : MOVIE.test(title) ? 'movie' : undefined;
  return { candidates: candidates.slice(0, MAX_CANDIDATES), year, type, people: people.slice(0, MAX_PEOPLE) };
}
