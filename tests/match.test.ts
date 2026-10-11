import { describe, expect, it } from 'vitest';
import { jaroWinkler } from '../src/match/similarity';
import { normalizeTitle, parseReleaseName } from '../src/match/parseTitle';

describe('normalizeTitle', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalizeTitle('Amélie')).toBe('amelie');
    expect(normalizeTitle("Marvel's  Spider-Man: Homecoming!")).toBe('marvel s spider man homecoming');
    expect(normalizeTitle('Fast & Furious')).toBe('fast and furious');
  });

  it('keeps letters from other scripts', () => {
    expect(normalizeTitle('दंगल')).not.toBe('');
  });
});

describe('jaroWinkler', () => {
  it('is 1 for identical strings and 0 for nothing in common', () => {
    expect(jaroWinkler('dark', 'dark')).toBe(1);
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
    expect(jaroWinkler('', 'x')).toBe(0);
  });

  it('scores a near match high and an unrelated title low', () => {
    expect(jaroWinkler('breaking bad', 'breaking bda')).toBeGreaterThan(0.9);
    expect(jaroWinkler('breaking bad', 'the crown')).toBeLessThan(0.6);
  });

  it('matches the textbook example', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.9611, 3);
  });
});

describe('parseReleaseName', () => {
  it('reads a series release', () => {
    expect(parseReleaseName('The.Boys.S03E05.1080p.WEB.H264-GLHF')).toEqual({
      title: 'The Boys', year: undefined, season: 3, episode: 5, type: 'tv',
    });
  });

  it('reads a movie release with the year', () => {
    expect(parseReleaseName('Dune.Part.Two.2024.2160p.UHD.BluRay.x265-GROUP')).toMatchObject({
      title: 'Dune Part Two', year: 2024, type: 'movie',
    });
  });

  it('drops a leading site tag and reads a bracketed year', () => {
    expect(parseReleaseName('[YTS.MX] Oppenheimer (2023) [1080p]')).toMatchObject({ title: 'Oppenheimer', year: 2023 });
    expect(parseReleaseName('www.site.com - Joker (2019) 720p')).toMatchObject({ title: 'Joker', year: 2019 });
  });

  it('keeps a year that is part of the title', () => {
    expect(parseReleaseName('Blade Runner 2049 (2017) 1080p')).toMatchObject({ title: 'Blade Runner 2049', year: 2017 });
    expect(parseReleaseName('2001 A Space Odyssey 1968 1080p')).toMatchObject({ title: '2001 A Space Odyssey', year: 1968 });
  });

  it('reads a season pack and the 1x05 form', () => {
    expect(parseReleaseName('Breaking Bad Season 2 Complete 720p')).toMatchObject({ title: 'Breaking Bad', season: 2, episode: undefined, type: 'tv' });
    expect(parseReleaseName('Friends 3x07 HDTV')).toMatchObject({ title: 'Friends', season: 3, episode: 7 });
  });

  it('returns a plain title untouched', () => {
    expect(parseReleaseName('Stranger Things')).toEqual({ title: 'Stranger Things', year: undefined, season: undefined, episode: undefined, type: undefined });
  });
});
