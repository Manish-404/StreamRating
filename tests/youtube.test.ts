import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchQuery } from '../src/match/types';
import { adapterFor } from '../src/sites';
import { VIDEO_TITLE_MIN_CONFIDENCE, youtube } from '../src/sites/youtube';

const el = (id: string) => document.getElementById(id)!;

describe('youtube tiles', () => {
  beforeEach(() => {
    document.body.innerHTML = readFileSync('tests/fixtures/youtube.html', 'utf8');
  });

  it('claims www.youtube.com only', () => {
    expect(adapterFor(new URL('https://www.youtube.com/results?search_query=x'))?.id).toBe('youtube');
    expect(adapterFor(new URL('https://music.youtube.com/'))).toBeUndefined();
    expect(adapterFor(new URL('https://example.com/www.youtube.com'))).toBeUndefined();
  });

  it('finds each video tile once, the innermost one, and skips Shorts', () => {
    expect(youtube.findCards(document).map((c) => c.id)).toEqual(['sold-search', 'upload', 'fan-edit', 'lockup-upload', 'sold-lockup', 'storefront']);
  });

  it('takes a film sold on YouTube by its name, with the year from the tile', () => {
    expect(youtube.extract(el('sold-search'))).toEqual({ title: 'Oppenheimer', year: 2023, type: 'movie', platform: 'youtube', platformId: 'vO2N0LGvhWc' });
    expect(youtube.extract(el('storefront'))).toEqual({ title: 'Gangs Of Wasseypur', year: 2012, type: 'movie', platform: 'youtube', platformId: '5hrIdP05Pew' });
    // The newer lockup has no special tag: the channel and "Buy or rent" give it away.
    expect(youtube.extract(el('sold-lockup'))).toEqual({ title: 'The Blind Side', year: 2009, type: 'movie', platform: 'youtube', platformId: 'ln5sgt82j6U' });
  });

  it('splits a year off the name of a film sold on YouTube', () => {
    const h3 = el('sold-lockup').querySelector('h3')!;
    h3.setAttribute('title', 'Napoleon (2023)');
    expect(youtube.extract(el('sold-lockup'))).toMatchObject({ title: 'Napoleon', year: 2023, type: 'movie' });
  });

  it('reads the film out of an upload title that says movie, and asks for a sure match', () => {
    expect(youtube.extract(el('upload'))).toEqual({
      title: 'Oppenheimer',
      year: 2023,
      type: 'movie',
      platform: 'youtube',
      platformId: '9Zgs4i7Kyrw',
      yearIsUpload: true,
      minConfidence: VIDEO_TITLE_MIN_CONFIDENCE,
    });
    expect(youtube.extract(el('lockup-upload'))).toMatchObject({ title: 'Uri: The Surgical Strike', alternatives: ['Uri'], type: 'movie', platformId: 'j903ASEDWxc' });
  });

  it('gives no badge to a video that is not about a film', () => {
    expect(youtube.extract(el('fan-edit'))).toBeNull();
  });

  it('puts the badge on the picture, and only the picture opens the card', () => {
    expect(youtube.anchor(el('upload')).tagName).toBe('YTD-THUMBNAIL');
    expect(youtube.anchor(el('lockup-upload')).className).toBe('ytLockupViewModelContentImage');
    expect(youtube.hoverTarget!(el('upload'))).toBe(youtube.anchor(el('upload')));
  });
});

describe('youtube watch page', () => {
  const page = (h1: string, channel: string, videoId = 'vO2N0LGvhWc') =>
    '<ytd-watch-metadata video-id="' + videoId + '"><div id="title"><h1><yt-formatted-string title="' + h1 + '">' + h1 +
    '</yt-formatted-string></h1></div><div id="top-row"><ytd-channel-name>' + channel + '</ytd-channel-name></div></ytd-watch-metadata>' +
    '<ytd-metadata-row-container-renderer>Provider NBCUniversal India Rating U/A13+ Release date 2023 Running time 3:02:47</ytd-metadata-row-container-renderer>';
  const find = (known = new Map<string, MatchQuery>()) => youtube.detail!.find(document, known);

  beforeEach(() => {
    // happy-dom has no layout, so say everything is painted.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 40, top: 0, left: 0, right: 100, bottom: 40, x: 0, y: 0, toJSON: () => ({}) });
    window.history.pushState({}, '', '/watch?v=vO2N0LGvhWc');
  });

  it('rates a film sold on YouTube, under its title', () => {
    document.body.innerHTML = page('Oppenheimer', 'YouTube Movies &amp; TV');
    const found = find()!;
    expect(found.query).toEqual({ title: 'Oppenheimer', year: 2023, type: 'movie', platform: 'youtube', platformId: 'vO2N0LGvhWc' });
    expect(found.anchor.id).toBe('title');
  });

  it('rates an upload whose title says movie, and nothing else', () => {
    document.body.innerHTML = page('Oppenheimer (2023) | HD Full Movie | Universal Studios', 'Movie Busters');
    expect(find()?.query).toMatchObject({ title: 'Oppenheimer', year: 2023, minConfidence: VIDEO_TITLE_MIN_CONFIDENCE, platformId: 'vO2N0LGvhWc' });
    document.body.innerHTML = page('Robert Oppenheimer &amp; Jean Tatlock || Only love can hurt like this', 'Archiekins');
    expect(find()).toBeNull();
  });

  it('uses what the tile said when the video was opened from one', () => {
    document.body.innerHTML = page('Oppenheimer', 'Someone');
    const known = new Map([['vO2N0LGvhWc', { title: 'Oppenheimer', year: 2023, type: 'movie' as const, platform: 'youtube' as const }]]);
    expect(find(known)?.query).toEqual({ title: 'Oppenheimer', year: 2023, type: 'movie', platform: 'youtube', platformId: 'vO2N0LGvhWc' });
  });

  it('waits while the title still belongs to the previous video', () => {
    document.body.innerHTML = page('Oppenheimer', 'YouTube Movies &amp; TV', 'previousVid');
    expect(find()).toBeNull();
  });

  it('does nothing off the watch page', () => {
    document.body.innerHTML = page('Oppenheimer', 'YouTube Movies &amp; TV');
    window.history.pushState({}, '', '/results?search_query=oppenheimer');
    expect(find()).toBeNull();
  });
});
