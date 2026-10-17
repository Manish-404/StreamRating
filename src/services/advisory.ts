import { cached } from '../db/cache';
import type { MediaType } from '../db/types';

/** Sex/nudity, violence/gore and language, each 0 (none) to 10 (extreme), or null when the source has no score for it. */
export interface AdvisoryScores {
  sex: number | null;
  violence: number | null;
  language: number | null;
}

export interface Advisory {
  /** Kids-In-Mind's own 0-10 scores, for films it has reviewed. */
  kim: AdvisoryScores | null;
  kimUrl: string | null;
  /** IMDb's Parents Guide severity (None/Mild/Moderate/Severe) turned into 0-10, so only roughly comparable. */
  imdb: AdvisoryScores | null;
  imdbUrl: string | null;
  /** Why a source gave nothing, for the console when the box is empty. */
  notes: string[];
}

export type AdvisoryResult = { status: 'ok'; advisory: Advisory } | { status: 'none'; notes: string[] } | { status: 'error'; message: string };

export interface AdvisoryQuery {
  title: string;
  year?: number;
  type: MediaType;
  imdbId: string | null;
}

const DAY = 24 * 60 * 60 * 1000;
const FOUND_TTL = 30 * DAY;
/** A title with no scores is checked again after a few days: a new film is added to these sites later. */
const MISSING_TTL = 3 * DAY;

const SEVERITY: Record<string, number> = { none: 0, mild: 3, moderate: 6, severe: 9 };

const tidy = (html: string) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const inRange = (n: number) => Number.isInteger(n) && n >= 0 && n <= 10;

/**
 * The three scores of a Kids-In-Mind review page. Its summary reads "Sex & nudity 1/10, violence & gore 10/10,
 * language 6/10"; the headings read "Final Destination: Bloodlines SEX/NUDITY 1".
 */
export function parseKidsInMind(html: string): AdvisoryScores | null {
  const text = tidy(html);
  const grab = (...patterns: RegExp[]) => {
    for (const re of patterns) {
      const m = re.exec(text);
      if (m) return Number(m[1]);
    }
    return NaN;
  };
  const sex = grab(/sex\s*&\s*nudity\s*(\d{1,2})\s*\/\s*10/i, /SEX\s*\/\s*NUDITY\W{0,12}(\d{1,2})/i);
  const violence = grab(/violence\s*&\s*gore\s*(\d{1,2})\s*\/\s*10/i, /VIOLENCE\s*\/\s*GORE\W{0,12}(\d{1,2})/i);
  const language = grab(/language\s*(\d{1,2})\s*\/\s*10/i, /LANGUAGE\W{0,12}(\d{1,2})/i);
  return inRange(sex) && inRange(violence) && inRange(language) ? { sex, violence, language } : null;
}

/** The Parents Guide severity of each of the three categories, as 0-10. At least one must be found. */
export function parseImdbGuide(html: string): AdvisoryScores | null {
  const text = tidy(html);
  // The summary at the top reads "Sex & Nudity: None Violence & Gore: Severe Profanity: Moderate".
  const pick = (name: RegExp) => {
    const m = new RegExp(name.source + String.raw`\s*:?\s*(none|mild|moderate|severe)\b`, 'i').exec(text);
    return m ? (SEVERITY[(m[1] ?? '').toLowerCase()] ?? NaN) : NaN;
  };
  const sex = pick(/sex\s*&\s*nudity/);
  const violence = pick(/violence\s*&\s*gore/);
  const language = pick(/profanity/);
  if ([sex, violence, language].every(Number.isNaN)) return null;
  const orNull = (n: number) => (Number.isNaN(n) ? null : n);
  return { sex: orNull(sex), violence: orNull(violence), language: orNull(language) };
}

/**
 * Kids-In-Mind's page addresses, e.g. /f/final-destination-bloodlines-parents-guide-movie-review-rating.htm: the
 * first letter's folder, the title's words, a leading "The" moved to the end ("beast-the"), and the year when two
 * films share a name ("beast-the-2026"). Older reviews have the short form, e.g. /t/ted.htm. Most likely first.
 */
export function kidsInMindUrls(title: string, year?: number): string[] {
  const words = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’.]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!words) return [];
  const article = /^(the|a|an)-(.+)$/.exec(words);
  const bases = article ? [article[2] + '-' + article[1], words] : [words];
  const slugs = [...bases, ...(year ? bases.map((b) => b + '-' + year) : [])];
  const folder = (slug: string) => 'https://kids-in-mind.com/' + (/^[0-9]/.test(slug) ? '0-9' : slug.charAt(0)) + '/' + slug;
  return [...slugs.map((slug) => folder(slug) + '-parents-guide-movie-review-rating.htm'), ...slugs.map((slug) => folder(slug) + '.htm')];
}

/**
 * One film of Kids-In-Mind's "Movie Reviews by Title" index, as it is kept: [name as the index sorts it, year,
 * page path, "sex.violence.language"]. Short on purpose: a whole letter is about 300 of these.
 */
export type KimRow = [name: string, year: number, path: string, scores: string];

/** What a lookup returns for one film: its page and scores. */
export interface KimIndexEntry {
  year: number;
  url: string;
  scores: AdvisoryScores;
}

const decodeEntities = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ');

/** A title as the index sorts it: "Abyss, The" and "The Abyss" are both "abyss". */
export function indexName(title: string): string {
  const plain = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const trailing = /^(.+?),\s*(the|a|an)$/.exec(plain);
  const leading = /^(?:the|a|an)\s+(.+)$/.exec(plain);
  return (trailing?.[1] ?? leading?.[1] ?? plain).replace(/[^a-z0-9]+/g, '');
}

/**
 * The lines of a letter page such as https://kids-in-mind.com/a.htm, which read
 * `<a href="/a/aquaman-parents-guide-movie-review-rating.htm">Aquaman</a> [2018] [PG-13] – 2.5.4`
 * (sex . violence . language). Each title is cleaned here once, so a lookup is a plain comparison.
 */
export function parseKimIndex(html: string): KimRow[] {
  const line = /<a href="(\/[a-z0-9-]+\/[^"]+\.htm)"[^>]*>([^<]+)<\/a>\s*\[(\d{4})\](?:\s*\[[^\]]*\])?\s*(?:&#8211;|–|-)\s*(\d{1,2}\.\d{1,2}\.\d{1,2})/g;
  const rows: KimRow[] = [];
  for (const m of html.matchAll(line)) {
    const [, path = '', title = '', year = '', scores = ''] = m;
    rows.push([indexName(decodeEntities(title)), Number(year), path, scores]);
  }
  return rows;
}

/** The letter page a title is listed under: its first letter, not counting a leading "The". */
export function indexLetter(title: string): string | null {
  const first = /^[a-z]/.exec(indexName(title)) ?? /^[0-9]/.exec(indexName(title));
  return first ? first[0] : null;
}

function expand(row: KimRow): KimIndexEntry {
  const [sex = 0, violence = 0, language = 0] = row[3].split('.').map(Number);
  return { year: row[1], url: 'https://kids-in-mind.com' + row[2], scores: { sex, violence, language } };
}

/** The entry for a film: the same name, in the same year (a year either side is allowed), else the only one with that name. */
export function findInIndex(rows: KimRow[], title: string, year?: number): KimIndexEntry | null {
  const name = indexName(title);
  if (!name) return null;
  const same = rows.filter((r) => r[0] === name);
  if (year) {
    const near = same.find((r) => r[1] === year) ?? same.find((r) => Math.abs(r[1] - year) === 1);
    if (near) return expand(near);
  }
  return same.length === 1 ? expand(same[0]!) : null;
}

export function createAdvisory(deps: { fetchText(url: string): Promise<string | null> }) {
  /** The letters already read in this session, so a second hover does not even open the database. */
  const open = new Map<string, { rows: KimRow[]; at: number }>();

  /** One letter's index: kept for a week in the database, and for a day in memory. */
  async function kimIndex(letter: string): Promise<KimRow[]> {
    const held = open.get(letter);
    if (held && Date.now() - held.at < DAY) return held.rows;
    // kimindex2: the first version kept whole objects; those copies are not read.
    const rows = await cached<KimRow[]>('kimindex2:' + letter, 7 * DAY, async () => {
      const text = await deps.fetchText('https://kids-in-mind.com/' + letter + '.htm');
      const parsed = parseKimIndex(text ?? '');
      if (parsed.length === 0) throw new Error('no films listed on kids-in-mind.com/' + letter + '.htm');
      return parsed;
    });
    open.set(letter, { rows, at: Date.now() });
    return rows;
  }

  type Found = { scores: AdvisoryScores; url: string } | null;

  async function fromKidsInMind(q: AdvisoryQuery, notes: string[]): Promise<Found> {
    // Kids-In-Mind reviews films; its series pages are per season and not matched here.
    if (q.type !== 'movie') return null;
    // The A-Z index first: it names the page and carries the scores. New films may not be listed yet.
    const letter = indexLetter(q.title);
    if (letter) {
      try {
        const hit = findInIndex(await kimIndex(letter), q.title, q.year);
        if (hit) return { scores: hit.scores, url: hit.url };
        notes.push('Kids-In-Mind index ' + letter + '.htm has no "' + q.title + '"' + (q.year ? ' (' + q.year + ')' : ''));
      } catch (e) {
        notes.push('Kids-In-Mind index ' + letter + '.htm: ' + (e instanceof Error ? e.message : String(e)));
      }
    }
    for (const url of kidsInMindUrls(q.title, q.year)) {
      const text = await deps.fetchText(url);
      const scores = parseKidsInMind(text ?? '');
      if (scores) return { scores, url };
      notes.push('Kids-In-Mind ' + url + (text === null ? ' (no page)' : ' (page has no scores)'));
    }
    return null;
  }

  async function fromImdb(q: AdvisoryQuery, notes: string[]): Promise<Found> {
    if (!q.imdbId) {
      notes.push('IMDb (no IMDb id for this title)');
      return null;
    }
    const url = 'https://www.imdb.com/title/' + q.imdbId + '/parentalguide/';
    const text = await deps.fetchText(url);
    const scores = parseImdbGuide(text ?? '');
    if (!scores) notes.push('IMDb ' + url + (text === null ? ' (no page)' : ' (page has no severity: ' + text.length + ' characters)'));
    return scores ? { scores, url } : null;
  }

  return async function getAdvisory(q: AdvisoryQuery): Promise<AdvisoryResult> {
    // v3: results saved before the old short addresses (/t/ted.htm) were tried must not be reused.
    const key = 'advisory5:' + (q.imdbId ?? q.type + ':' + q.title.toLowerCase() + ':' + (q.year ?? ''));
    try {
      const value = await cached<Advisory>(
        key,
        (v) => (v.kim || v.imdb ? FOUND_TTL : MISSING_TTL),
        async () => {
          // Each source on its own: one being blocked or empty must not hide the other.
          const notes: string[] = [];
          const [kim, imdb] = await Promise.all([fromKidsInMind(q, notes).catch(() => null), fromImdb(q, notes).catch(() => null)]);
          return { kim: kim?.scores ?? null, kimUrl: kim?.url ?? null, imdb: imdb?.scores ?? null, imdbUrl: imdb?.url ?? null, notes };
        },
      );
      return value.kim || value.imdb ? { status: 'ok', advisory: value } : { status: 'none', notes: value.notes ?? [] };
    } catch (e) {
      return { status: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  };
}

/** Reads a page as the browser would, with its cookies; null when the site refuses or is down. */
export async function fetchPageText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(10000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}
