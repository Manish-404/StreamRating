import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/schema';
import { createAdvisory, findInIndex, indexLetter, kidsInMindUrls, parseImdbGuide, parseKidsInMind, parseKimIndex } from '../src/services/advisory';

const REAL_KIM = readFileSync('tests/fixtures/kim-final-destination.html', 'utf8');
const REAL_IMDB = readFileSync('tests/fixtures/imdb-guide-final-destination.html', 'utf8');
const KIM = '<html><title>Black Adam - Kids-In-Mind</title><div class="ratings"><b>SEX/NUDITY</b> 2 &bull; <b>VIOLENCE/GORE</b> 7 &bull; <b>LANGUAGE</b> 5</div></html>';
const guide = (n: string, v: string, p: string) =>
  `<ul><li>Sex &amp; Nudity:</li><li>${n}</li><li>Violence &amp; Gore:</li><li>${v}</li><li>Profanity:</li><li>${p}</li><li>Alcohol, Drugs &amp; Smoking:</li><li>Severe</li></ul>`;

beforeEach(async () => {
  await db.cache.clear();
});

describe('the real pages for Final Destination: Bloodlines', () => {
  it('reads Kids-In-Mind 1 / 10 / 6', () => expect(parseKidsInMind(REAL_KIM)).toEqual({ sex: 1, violence: 10, language: 6 }));
  it('reads IMDb None / Severe / Moderate as 0 / 9 / 6', () => expect(parseImdbGuide(REAL_IMDB)).toEqual({ sex: 0, violence: 9, language: 6 }));
});

describe('an older Kids-In-Mind page (Ted)', () => {
  it('reads 8 / 5 / 10', () => expect(parseKidsInMind(readFileSync('tests/fixtures/kim-ted-old.html', 'utf8'))).toEqual({ sex: 8, violence: 5, language: 10 }));
});

describe('parseKidsInMind', () => {
  it('reads the three scores', () => expect(parseKidsInMind(KIM)).toEqual({ sex: 2, violence: 7, language: 5 }));
  it('gives null for a blocked or unrelated page', () => {
    expect(parseKidsInMind('<title>Attention Required! | Cloudflare</title>')).toBeNull();
    expect(parseKidsInMind('')).toBeNull();
  });
});

describe('parseImdbGuide', () => {
  it('turns severity into 0-10 and ignores other categories', () => {
    expect(parseImdbGuide(guide('Mild', 'Severe', 'None'))).toEqual({ sex: 3, violence: 9, language: 0 });
  });
  it('leaves a missing category null, and gives null when none is found', () => {
    expect(parseImdbGuide('<p>Violence &amp; Gore: Moderate</p>')).toEqual({ sex: null, violence: 6, language: null });
    expect(parseImdbGuide('<html>challenge</html>')).toBeNull();
  });
});

describe('kidsInMindUrls', () => {
  const tail = '-parents-guide-movie-review-rating.htm';
  it('builds the letter folder and the words', () => {
    expect(kidsInMindUrls('Final Destination: Bloodlines')).toEqual([
      'https://kids-in-mind.com/f/final-destination-bloodlines' + tail,
      'https://kids-in-mind.com/f/final-destination-bloodlines.htm',
    ]);
    expect(kidsInMindUrls('Ted')).toContain('https://kids-in-mind.com/t/ted.htm');
    expect(kidsInMindUrls('Spider-Man: No Way Home')[0]).toBe('https://kids-in-mind.com/s/spider-man-no-way-home' + tail);
  });
  it('moves a leading The to the end and tries the year for films sharing a name', () => {
    expect(kidsInMindUrls('The Beast', 2026).slice(0, 4)).toEqual([
      'https://kids-in-mind.com/b/beast-the' + tail,
      'https://kids-in-mind.com/t/the-beast' + tail,
      'https://kids-in-mind.com/b/beast-the-2026' + tail,
      'https://kids-in-mind.com/t/the-beast-2026' + tail,
    ]);
  });
});

describe('createAdvisory', () => {
  const q = { title: 'Black Adam', year: 2022, type: 'movie' as const, imdbId: 'tt6443346' };

  it('shows both sources when both have scores', async () => {
    const fetchText = vi.fn(async (url: string) => (url.includes('kids-in-mind') ? KIM : guide('Mild', 'Severe', 'Moderate')));
    const r = await createAdvisory({ fetchText })(q);
    expect(r).toMatchObject({ status: 'ok', advisory: { kim: { sex: 2, violence: 7, language: 5 }, imdb: { sex: 3, violence: 9, language: 6 } } });
  });

  it('still shows IMDb when Kids-In-Mind is blocked, and the other way round', async () => {
    const blocked = createAdvisory({ fetchText: async (url) => (url.includes('kids-in-mind') ? null : guide('None', 'None', 'None')) });
    expect(await blocked(q)).toMatchObject({ status: 'ok', advisory: { kim: null, imdb: { sex: 0 } } });
    await db.cache.clear();
    const noImdb = createAdvisory({ fetchText: async (url) => (url.includes('kids-in-mind') ? KIM : null) });
    expect(await noImdb(q)).toMatchObject({ status: 'ok', advisory: { imdb: null, kim: { violence: 7 } } });
  });

  it('says none when neither has anything, and does not ask Kids-In-Mind about series', async () => {
    const fetchText = vi.fn(async (_url: string) => null as string | null);
    expect(await createAdvisory({ fetchText })({ ...q, type: 'tv' })).toMatchObject({ status: 'none' });
    expect(fetchText.mock.calls.some(([u]) => String(u).includes('kids-in-mind'))).toBe(false);
  });

  it('asks each page once for a title that is shown twice', async () => {
    const fetchText = vi.fn(async (url: string) => (url.includes('kids-in-mind') ? KIM : null));
    const get = createAdvisory({ fetchText });
    await get(q);
    const calls = fetchText.mock.calls.length;
    await get(q);
    expect(fetchText.mock.calls.length).toBe(calls);
  });
});

describe('the A-Z index (kids-in-mind.com/a.htm)', () => {
  const INDEX = readFileSync('tests/fixtures/kim-index-a.html', 'utf8');
  const rows = parseKimIndex(INDEX);

  it('keeps each film as a short row: cleaned name, year, page path, scores', () => {
    expect(rows).toContainEqual(['aquamanandthelostkingdom', 2023, '/a/aquaman-and-the-lost-kingdom-parents-guide-movie-review-rating.htm', '1.5.5']);
    expect(rows).toContainEqual(['abyss', 1989, expect.stringMatching(/^\/a\//), '4.5.5']);
  });

  it('turns a row back into the page address and three numbers', () => {
    expect(findInIndex(rows, 'Aquaman and the Lost Kingdom', 2023)).toEqual({
      year: 2023,
      url: 'https://kids-in-mind.com/a/aquaman-and-the-lost-kingdom-parents-guide-movie-review-rating.htm',
      scores: { sex: 1, violence: 5, language: 5 },
    });
  });

  it('files "The Abyss" and "Abyss, The" together, under A', () => {
    expect(indexLetter('The Abyss')).toBe('a');
    expect(indexLetter('Abyss, The')).toBe('a');
    expect(findInIndex(rows, 'The Abyss', 1989)?.scores).toEqual({ sex: 4, violence: 5, language: 5 });
  });

  it('picks the right one of two films with the same name by year', () => {
    expect(findInIndex(rows, 'Anaconda', 2025)?.scores).toEqual({ sex: 1, violence: 7, language: 5 });
    expect(findInIndex(rows, 'Anaconda', 1997)?.scores).toEqual({ sex: 4, violence: 8, language: 5 });
    expect(findInIndex(rows, 'Aquaman', 2019)?.year).toBe(2018);
  });

  it('is much smaller than whole objects with full addresses', () => {
    const old = parseKimIndex(INDEX).map(([name, year, path, scores]) => {
      const [sex, violence, language] = scores.split('.').map(Number);
      return { title: name, year, url: 'https://kids-in-mind.com' + path, scores: { sex, violence, language } };
    });
    expect(JSON.stringify(rows).length).toBeLessThan(JSON.stringify(old).length * 0.7);
  });

  it('answers from the index without opening the film page, and reads the letter once', async () => {
    const fetchText = vi.fn(async (url: string) => (url.endsWith('/a.htm') ? INDEX : null));
    const get = createAdvisory({ fetchText });
    const r = await get({ title: 'Aquaman and the Lost Kingdom', year: 2023, type: 'movie', imdbId: null });
    expect(r).toMatchObject({ status: 'ok', advisory: { kim: { sex: 1, violence: 5, language: 5 } } });
    await get({ title: 'Aquaman', year: 2018, type: 'movie', imdbId: null });
    expect(fetchText.mock.calls.map(([u]) => u)).toEqual(['https://kids-in-mind.com/a.htm']);
  });

  it('keeps the letter in the database too: a new session does not download it again', async () => {
    const fetchText = vi.fn(async (url: string) => (url.endsWith('/a.htm') ? INDEX : null));
    await createAdvisory({ fetchText })({ title: 'Anaconda', year: 2025, type: 'movie', imdbId: null });
    const second = createAdvisory({ fetchText }); // a fresh session: nothing in memory
    const r = await second({ title: 'Anaconda', year: 1997, type: 'movie', imdbId: null });
    expect(r).toMatchObject({ status: 'ok', advisory: { kim: { violence: 8 } } });
    expect(fetchText.mock.calls.filter(([u]) => String(u).endsWith('/a.htm'))).toHaveLength(1);
  });
});
