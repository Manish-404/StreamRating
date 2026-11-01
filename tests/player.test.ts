import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlayerWatcher, type WatcherLink } from '../src/content/playerWatcher';
import type { PlayedInput } from '../src/db/userData';
import type { LookupResult, MatchQuery, TitleInfo } from '../src/match/types';
import { netflix } from '../src/sites/netflix';
import { youtube } from '../src/sites/youtube';

// The title line is written from memory of Netflix's player (series name, then "S2:E3", then the episode's name).
// It is not captured from the live site: the extension logs the real markup when it cannot read it.
const titleLine = (...pieces: string[]) =>
  '<div data-uia="video-title">' + pieces.map((p, i) => (i === 0 ? '<h4>' + p + '</h4>' : '<span>' + p + '</span>')).join('') + '</div>';

const nowPlaying = (known = new Map<string, MatchQuery>()) => netflix.player!.nowPlaying(document, known);

describe('netflix player page', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/watch/80057281?trackId=1');
  });

  it('reads a film: just its name', () => {
    document.body.innerHTML = titleLine('Red Notice');
    expect(nowPlaying()).toEqual({ id: '80057281', query: { title: 'Red Notice', platform: 'netflix', platformId: '80057281' } });
  });

  it('reads an episode: the series, the season and the episode', () => {
    document.body.innerHTML = titleLine('Stranger Things', 'S4:E3', 'Chapter Three: The Monster and the Superhero');
    expect(nowPlaying()).toEqual({
      id: '80057281',
      query: { title: 'Stranger Things', platform: 'netflix', platformId: '80057281', type: 'tv' },
      season: 4,
      episode: 3,
    });
  });

  it('reads the spelled-out and the one-season forms', () => {
    document.body.innerHTML = titleLine('Dark', 'Season 2: Episode 5', 'Name');
    expect(nowPlaying()).toMatchObject({ season: 2, episode: 5 });
    document.body.innerHTML = titleLine('Wednesday', 'E7', 'Name');
    expect(nowPlaying()).toMatchObject({ season: 1, episode: 7 });
    document.body.innerHTML = titleLine('Wednesday', 'Ep. 2', 'Name');
    expect(nowPlaying()).toMatchObject({ season: 1, episode: 2 });
  });

  it('knows nothing while the controls (and so the title line) are hidden', () => {
    document.body.innerHTML = '<video></video>';
    expect(nowPlaying()).toBeNull();
  });

  it('falls back to the thumbnail it opened from, for a film, while the controls are hidden', () => {
    document.body.innerHTML = '<video></video>';
    const known = new Map([['80057281', { title: 'Red Notice', year: 2021, platform: 'netflix' as const, platformId: '80057281' }]]);
    expect(nowPlaying(known)?.query).toMatchObject({ title: 'Red Notice', year: 2021 });
  });

  it('is only the /watch/ pages', () => {
    expect(netflix.player!.isPlayerPage(new URL('https://www.netflix.com/watch/80057281?x=1'))).toBe(true);
    expect(netflix.player!.isPlayerPage(new URL('https://www.netflix.com/browse?jbv=80057281'))).toBe(false);
    window.history.pushState({}, '', '/browse');
    document.body.innerHTML = titleLine('Red Notice');
    expect(nowPlaying()).toBeNull();
  });
});

describe('youtube player page', () => {
  const page = (h1: string, channel = 'Movie Busters', videoId = 'vO2N0LGvhWc') =>
    '<ytd-watch-metadata video-id="' + videoId + '"><div id="title"><h1><yt-formatted-string title="' + h1 + '">' + h1 +
    '</yt-formatted-string></h1></div><ytd-channel-name>' + channel + '</ytd-channel-name></ytd-watch-metadata>';

  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 40, top: 0, left: 0, right: 100, bottom: 40, x: 0, y: 0, toJSON: () => ({}) });
    window.history.pushState({}, '', '/watch?v=vO2N0LGvhWc');
  });

  it('names a film upload and a film sold on YouTube, and nothing else', () => {
    document.body.innerHTML = page('Oppenheimer (2023) | HD Full Movie | Universal Studios');
    expect(youtube.player!.nowPlaying(document, new Map())).toMatchObject({ id: 'vO2N0LGvhWc', query: { title: 'Oppenheimer', year: 2023 } });
    document.body.innerHTML = page('Oppenheimer', 'YouTube Movies &amp; TV');
    expect(youtube.player!.nowPlaying(document, new Map())?.query).toMatchObject({ title: 'Oppenheimer', type: 'movie' });
    document.body.innerHTML = page('Robert Oppenheimer &amp; Jean Tatlock || Only love can hurt like this', 'Archiekins');
    expect(youtube.player!.nowPlaying(document, new Map())).toBeNull();
  });

  it('knows an advert is on, and that a short video is a trailer', () => {
    document.body.innerHTML = '<div class="html5-video-player"></div>';
    expect(youtube.player!.adPlaying!(document)).toBe(false);
    document.body.innerHTML = '<div class="html5-video-player ad-showing"></div>';
    expect(youtube.player!.adPlaying!(document)).toBe(true);
    expect(youtube.player!.trailerMaxSeconds).toBe(25 * 60);
  });
});

// ---- the watcher, with a fake <video> and a fake background ----

interface FakeVideo extends HTMLVideoElement {
  fake: { currentTime: number; duration: number; paused: boolean; readyState: number };
}

function addVideo(duration: number): FakeVideo {
  const video = document.createElement('video') as FakeVideo;
  video.fake = { currentTime: 0, duration, paused: false, readyState: 4 };
  for (const key of ['currentTime', 'duration', 'paused', 'readyState'] as const) {
    Object.defineProperty(video, key, { get: () => video.fake[key], configurable: true });
  }
  Object.defineProperty(video, 'ended', { get: () => false, configurable: true });
  document.body.append(video);
  return video;
}

const info = (over: Partial<TitleInfo> = {}): TitleInfo => ({
  key: 'k', tmdbId: 872585, type: 'movie', imdbId: 'tt15398776', title: 'Oppenheimer', year: 2023, overview: '', genres: [], posterPath: null, cast: [], directors: [],
  tmdbRating: null, tmdbVotes: 0, imdbRating: null, imdbVotes: null, rtCritics: null, metacritic: null, ratingsStatus: 'ok', confidence: 0.95, ...over,
});

const settle = () => new Promise((r) => setTimeout(r, 0));

function harness(adapter: typeof netflix, lookupResult: LookupResult | (() => LookupResult) = { status: 'ok', info: info() }) {
  const recorded: PlayedInput[] = [];
  const lookup = vi.fn(async (_q: MatchQuery) => (typeof lookupResult === 'function' ? lookupResult() : lookupResult));
  const link: WatcherLink = { lookup, record: async (p) => void recorded.push(p) };
  let clock = 0;
  const watcher = createPlayerWatcher(adapter, link, () => clock);
  /** Plays `seconds` on the given video, one tick a second. */
  const run = async (video: FakeVideo, seconds: number) => {
    for (let i = 0; i < seconds; i++) {
      video.fake.currentTime += 1;
      clock += 1000;
      watcher.tick();
    }
    await settle();
  };
  return { watcher, recorded, lookup, run, advance: (ms: number) => (clock += ms) };
}

describe('player watcher on Netflix', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1280, height: 720, top: 0, left: 0, right: 1280, bottom: 720, x: 0, y: 0, toJSON: () => ({}) });
    window.history.pushState({}, '', '/watch/80057281');
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('saves a film after five minutes, and keeps the progress up to date', async () => {
    document.body.innerHTML = titleLine('Oppenheimer');
    const video = addVideo(3 * 3600);
    const { recorded, lookup, run } = harness(netflix);
    await run(video, 290);
    expect(recorded).toEqual([]);
    expect(lookup).not.toHaveBeenCalled(); // no lookup (and no OMDb request) for something merely sampled
    await run(video, 30);
    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded[0]).toMatchObject({ platform: 'netflix', title: { imdbId: 'tt15398776', type: 'movie', title: 'Oppenheimer' } });
    expect(recorded[0]).not.toHaveProperty('season');
    await run(video, 900);
    expect(recorded.at(-1)!.progress).toBeGreaterThan(recorded[0]!.progress);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('saves an episode with its season and number', async () => {
    document.body.innerHTML = titleLine('Stranger Things', 'S4:E3', 'Chapter Three');
    const video = addVideo(3000);
    const { recorded, run } = harness(netflix, { status: 'ok', info: info({ type: 'tv', imdbId: 'tt4574334', title: 'Stranger Things', tmdbId: 66732 }) });
    await run(video, 500);
    expect(recorded[0]).toMatchObject({ season: 4, episode: 3, title: { type: 'tv', title: 'Stranger Things' } });
  });

  it('leaves the episode out when the match turns out to be a film', async () => {
    document.body.innerHTML = titleLine('Ted', 'S1:E1', 'Name');
    const video = addVideo(3000);
    const { recorded, run } = harness(netflix);
    await run(video, 500);
    expect(recorded[0]).not.toHaveProperty('episode');
  });

  it('waits for the title line when the controls are hidden, then saves', async () => {
    document.body.innerHTML = '';
    const video = addVideo(3 * 3600);
    const { recorded, run } = harness(netflix);
    await run(video, 400);
    expect(recorded).toEqual([]);
    document.body.insertAdjacentElement('afterbegin', Object.assign(document.createElement('div'), { innerHTML: titleLine('Oppenheimer') }));
    await run(video, 1);
    expect(recorded).toHaveLength(1);
  });

  it('keeps the title after the controls hide again', async () => {
    document.body.innerHTML = titleLine('Oppenheimer');
    const video = addVideo(3 * 3600);
    const { recorded, run } = harness(netflix);
    await run(video, 100);
    document.body.querySelector('[data-uia="video-title"]')!.remove();
    await run(video, 250);
    expect(recorded.length).toBeGreaterThan(0);
  });

  it('does not save what it cannot match to a title', async () => {
    document.body.innerHTML = titleLine('Some Local Show');
    const video = addVideo(3000);
    const { recorded, run } = harness(netflix, { status: 'not_found' });
    await run(video, 600);
    expect(recorded).toEqual([]);
    const unsure = harness(netflix, { status: 'ok', info: info({ confidence: 0.4 }) });
    await unsure.run(video, 1);
    expect(unsure.recorded).toEqual([]);
  });

  it('asks again after a failed lookup instead of giving up on the title', async () => {
    document.body.innerHTML = titleLine('Oppenheimer');
    const video = addVideo(3 * 3600);
    let fail = true;
    const { recorded, lookup, run } = harness(netflix, () => (fail ? { status: 'error', kind: 'network', message: 'offline' } : { status: 'ok', info: info() }));
    await run(video, 330);
    expect(recorded).toEqual([]);
    fail = false;
    await run(video, 400); // the next save (progress moved on 5%?) or the flush retries
    video.fake.paused = true;
    await run(video, 1);
    expect(lookup.mock.calls.length).toBeGreaterThan(1);
    expect(recorded.at(-1)).toMatchObject({ title: { title: 'Oppenheimer' } });
  });

  it('does not count a paused video', async () => {
    document.body.innerHTML = titleLine('Oppenheimer');
    const video = addVideo(3 * 3600);
    video.fake.paused = true;
    const { recorded, run } = harness(netflix);
    await run(video, 1000);
    expect(recorded).toEqual([]);
  });

  it('starts over for the next episode', async () => {
    document.body.innerHTML = titleLine('Stranger Things', 'S1:E1', 'A');
    const video = addVideo(3000);
    const { recorded, run } = harness(netflix, { status: 'ok', info: info({ type: 'tv', title: 'Stranger Things', imdbId: 'tt4574334' }) });
    await run(video, 500);
    window.history.pushState({}, '', '/watch/80057282');
    document.body.querySelector('[data-uia="video-title"]')!.innerHTML = '<h4>Stranger Things</h4><span>S1:E2</span><span>B</span>';
    video.fake.currentTime = 0;
    await run(video, 500);
    expect(recorded.map((r) => r.episode)).toContain(1);
    expect(recorded.map((r) => r.episode)).toContain(2);
  });

  it('does nothing off the player page', async () => {
    window.history.pushState({}, '', '/browse');
    document.body.innerHTML = titleLine('Oppenheimer');
    const video = addVideo(3000);
    const { recorded, run } = harness(netflix);
    await run(video, 1000);
    expect(recorded).toEqual([]);
  });

  it('reports a player it cannot read, once', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const video = addVideo(3000);
    const { run } = harness(netflix);
    await run(video, 60);
    expect(log.mock.calls.filter((c) => String(c[0]).includes('cannot tell what is playing'))).toHaveLength(1);
  });
});

describe('player watcher on YouTube', () => {
  const page = (h1: string, extra = '') =>
    '<ytd-watch-metadata video-id="vO2N0LGvhWc"><div id="title"><h1><yt-formatted-string title="' + h1 + '">' + h1 +
    '</yt-formatted-string></h1></div><ytd-channel-name>Movie Busters</ytd-channel-name></ytd-watch-metadata>' + extra;

  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1280, height: 720, top: 0, left: 0, right: 1280, bottom: 720, x: 0, y: 0, toJSON: () => ({}) });
    window.history.pushState({}, '', '/watch?v=vO2N0LGvhWc');
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('saves a long upload as watched', async () => {
    document.body.innerHTML = page('Oppenheimer (2023) | HD Full Movie');
    const video = addVideo(3 * 3600);
    const { recorded, run } = harness(youtube as typeof netflix);
    await run(video, 320);
    expect(recorded[0]).toMatchObject({ platform: 'youtube', title: { title: 'Oppenheimer' } });
    expect(recorded[0]).not.toHaveProperty('trailer');
  });

  it('saves a short upload as a trailer view after half a minute', async () => {
    document.body.innerHTML = page('Oppenheimer | Official Trailer');
    const video = addVideo(150);
    const { recorded, run } = harness(youtube as typeof netflix);
    await run(video, 40);
    expect(recorded[0]).toMatchObject({ platform: 'youtube', trailer: true });
  });

  it('ignores a video that is not about a film', async () => {
    document.body.innerHTML = page('Robert Oppenheimer & Jean Tatlock || Only love can hurt like this');
    const video = addVideo(3 * 3600);
    const { recorded, lookup, run } = harness(youtube as typeof netflix);
    await run(video, 400);
    expect(recorded).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('does not count an advert, and does not mistake its length for the video\'s', async () => {
    document.body.innerHTML = page('Oppenheimer (2023) | HD Full Movie', '<div class="html5-video-player ad-showing"></div>');
    const video = addVideo(20); // the advert
    const { recorded, run } = harness(youtube as typeof netflix);
    await run(video, 20);
    video.fake.duration = 3 * 3600; // the film starts
    video.fake.currentTime = 0;
    document.body.querySelector('.html5-video-player')!.className = 'html5-video-player';
    await run(video, 320);
    expect(recorded[0]).toBeDefined();
    expect(recorded[0]).not.toHaveProperty('trailer');
  });
});
