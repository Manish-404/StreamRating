import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LookupResult, TitleInfo } from '../src/match/types';

const sendMessage = vi.fn();
vi.mock('../src/messaging/protocol', () => ({ sendMessage: (...a: unknown[]) => sendMessage(...a), onMessage: vi.fn() }));
vi.mock('../src/content/card', () => ({ scheduleOpen: vi.fn(), scheduleClose: vi.fn() }));

const { createBadges } = await import('../src/content/badges');
const { scheduleOpen } = await import('../src/content/card');
const { youtube } = await import('../src/sites/youtube');

const info = (tmdbId: number, title: string): TitleInfo => ({
  key: 'movie:' + tmdbId, tmdbId, type: 'movie', imdbId: 'tt' + tmdbId, title, year: 2023, overview: '', genres: [], posterPath: null,
  cast: [], directors: [], tmdbRating: 8, tmdbVotes: 5000, imdbRating: 8.2, imdbVotes: 900000, rtCritics: 93, metacritic: null,
  ratingsStatus: 'ok', confidence: 0.95,
});

/** A search result: its id, title and the length on its thumbnail. A film for sale is a different tile. */
function result(id: string, title: string, time: string, sold = false): string {
  const thumb =
    '<ytd-thumbnail><a id="thumbnail" href="/watch?v=' + id + '"><img src="t.jpg">' +
    '<ytd-thumbnail-overlay-time-status-renderer><span id="text">' + time + '</span></ytd-thumbnail-overlay-time-status-renderer></a></ytd-thumbnail>';
  const heading = '<h3><a id="video-title" title="' + title + '" href="/watch?v=' + id + '">' + title + '</a></h3>';
  return sold
    ? '<ytd-movie-renderer id="' + id + '">' + thumb + heading + '<div>Buy or rent Drama • 2023 U/A13+</div></ytd-movie-renderer>'
    : '<ytd-video-renderer id="' + id + '">' + thumb + heading + '</ytd-video-renderer>';
}

/** The search results for "oppenheimer", in order, as seen on YouTube (October 2026). */
const PAGE = [
  result('sold0000001', 'Oppenheimer', '3:02:47', true),
  result('new00000002', 'Oppenheimer | New Trailer', '3:07'),
  result('off00000003', 'Oppenheimer | Official Trailer', '2:03'),
  result('gita0000004', 'Oppenheimer Bhagavad-Gita Quote', '0:54'),
  result('hindi000005', 'OPPENHEIMER - New Hindi Trailer (Universal Pictures) - HD', '3:04'),
  result('real0000006', 'The Real Story of Oppenheimer | Hero or Villain? | Dhruv Rathee', '20:53'),
  result('dune0000007', 'Dune: Part Three | Official Trailer', '2:51'),
  result('imax0000008', '3 Minutes of Oppenheimer in 4K | IMAX', '3:31'),
  result('modi0000009', 'PM Narendra Modi - Official Trailer | Akshay Kumar | Paresh Rawal | Amit Shah | Modi Movie Trailer', '2:07'),
  result('clip0000010', '"Oppenheimer" clip: Trinity', '1:44'),
  result('fix00000011', 'I Fixed the Nuclear Bomb Explosion in Oppenheimer', '1:03'),
  result('dunk0000012', 'Dunkirk - Trailer 1 [HD]', '2:19'),
  result('estar000013', 'Oppenheimer - Official Trailer Starring Cillian Murphy', '1:58'),
].join('');

const flush = () => new Promise((r) => setTimeout(r, 0));
const card = (id: string) => document.getElementById(id)!;
const badgeText = (id: string) => card(id).querySelector('streamrating-badge')?.shadowRoot?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
const visitAll = (visit: (c: HTMLElement) => void) => youtube.findCards(document).forEach(visit);
/** The ids of the results that show a rating right now. */
const rated = () => youtube.findCards(document).filter((c) => badgeText(c.id)?.includes('IMDb')).map((c) => c.id);

/** Every lookup resolves to the film named in the title. */
function answerByTitle() {
  sendMessage.mockImplementation(async (_name: string, query: { title: string }) => {
    const film = /oppenheimer/i.test(query.title) ? info(872585, 'Oppenheimer')
      : /dune/i.test(query.title) ? info(693134, 'Dune: Part Three')
      : /modi/i.test(query.title) ? info(595583, 'PM Narendra Modi')
      : info(374720, 'Dunkirk');
    return { status: 'ok', info: film } satisfies LookupResult;
  });
}

describe('one rating per film in a YouTube search', () => {
  beforeEach(() => {
    sendMessage.mockReset();
    answerByTitle();
    document.body.innerHTML = PAGE;
  });

  it('names a film in the results that are about one, and in no others', () => {
    const named = youtube.findCards(document).filter((c) => youtube.extract(c)).map((c) => c.id);
    expect(named).toEqual(['sold0000001', 'new00000002', 'off00000003', 'hindi000005', 'dune0000007', 'modi0000009', 'dunk0000012', 'estar000013']);
  });

  it('puts the rating on the first result of each film only', async () => {
    visitAll(createBadges(youtube));
    await flush();
    // Oppenheimer: the film for sale, then four trailers that stay clean. Dune, Modi and Dunkirk each keep theirs.
    expect(rated()).toEqual(['sold0000001', 'dune0000007', 'modi0000009', 'dunk0000012']);
  });

  it('gives every video its rating when the setting is off', async () => {
    visitAll(createBadges(youtube, { oncePerFilm: () => false }));
    await flush();
    expect(rated()).toEqual(['sold0000001', 'new00000002', 'off00000003', 'hindi000005', 'dune0000007', 'modi0000009', 'dunk0000012', 'estar000013']);
  });

  it('follows the setting while the page is open', async () => {
    let once = true;
    const visit = createBadges(youtube, { oncePerFilm: () => once });
    visitAll(visit);
    await flush();
    expect(rated()).toHaveLength(4);
    once = false;
    visitAll(visit);
    expect(rated()).toHaveLength(8);
    once = true;
    visitAll(visit);
    expect(rated()).toEqual(['sold0000001', 'dune0000007', 'modi0000009', 'dunk0000012']);
  });

  it('sends the same lookups either way: the setting changes what is shown, not what is fetched', async () => {
    visitAll(createBadges(youtube));
    await flush();
    const asked = sendMessage.mock.calls.length;
    sendMessage.mockClear();
    visitAll(createBadges(youtube, { oncePerFilm: () => false }));
    await flush();
    expect(sendMessage.mock.calls.length).toBe(asked);
  });

  it('keeps the top result even when a lower one is rated first', async () => {
    const answers = new Map<string, () => void>();
    sendMessage.mockImplementation(
      (_name: string, query: { platformId: string }) =>
        new Promise((resolve) => answers.set(query.platformId, () => resolve({ status: 'ok', info: info(872585, 'Oppenheimer') }))),
    );
    visitAll(createBadges(youtube));
    answers.get('estar000013')!();
    await flush();
    expect(rated()).toEqual(['estar000013']);
    answers.get('sold0000001')!();
    await flush();
    expect(rated()).toEqual(['sold0000001']);
  });

  it('hands the rating to the next result of the film when the first goes away or is reused', async () => {
    const visit = createBadges(youtube);
    visitAll(visit);
    await flush();
    card('sold0000001').remove();
    visit(card('new00000002'));
    expect(rated()).toEqual(['new00000002', 'dune0000007', 'modi0000009', 'dunk0000012']);

    // The site reuses that tile for an unrelated video: the next Oppenheimer result takes over.
    card('new00000002').querySelector('#video-title')!.setAttribute('title', 'Top 10 Ways to Study');
    visit(card('new00000002'));
    expect(rated()).toEqual(['off00000003', 'dune0000007', 'modi0000009', 'dunk0000012']);
  });

  it('opens the hover card from the result that shows the rating, and not from a quiet one', async () => {
    vi.mocked(scheduleOpen).mockClear();
    visitAll(createBadges(youtube));
    await flush();
    const hover = (id: string) => card(id).querySelector('ytd-thumbnail')!.dispatchEvent(new MouseEvent('mouseenter'));
    hover('new00000002');
    expect(scheduleOpen).not.toHaveBeenCalled();
    hover('sold0000001');
    expect(scheduleOpen).toHaveBeenCalledTimes(1);
  });
});
