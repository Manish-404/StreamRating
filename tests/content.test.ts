import { readFileSync } from 'node:fs';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TitleState } from '../src/db/userData';
import type { LookupResult, TitleInfo } from '../src/match/types';

const sendMessage = vi.fn();
vi.mock('../src/messaging/protocol', () => ({ sendMessage: (...a: unknown[]) => sendMessage(...a), onMessage: vi.fn() }));

const { createBadges } = await import('../src/content/badges');
const { Badge } = await import('../src/content/Badge');
const { CardActions, HoverCard } = await import('../src/content/HoverCard');
const { netflix } = await import('../src/sites/netflix');

const info = (o: Partial<TitleInfo> = {}): TitleInfo => ({
  key: 'k', tmdbId: 1, type: 'tv', imdbId: 'tt5753856', title: 'Dark', year: 2017, overview: 'A missing child.',
  genres: ['Drama', 'Sci-Fi'], seasons: 3, posterPath: null, cast: ['A', 'B'], directors: ['C'], tmdbRating: 8.4,
  tmdbVotes: 5000, imdbRating: 8.7, imdbVotes: 400000, rtCritics: 95, metacritic: null, ratingsStatus: 'ok', confidence: 0.9, ...o,
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const card = (n: number) => document.getElementById('card-' + n)!;
const badgeText = (c: HTMLElement) => c.querySelector('streamrating-badge')?.shadowRoot?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

beforeEach(() => {
  sendMessage.mockReset();
  document.body.innerHTML = readFileSync('tests/fixtures/netflix-browse.html', 'utf8');
});

describe('badges on thumbnails', () => {
  it('shows a loading chip, then the ratings once the background answers', async () => {
    sendMessage.mockResolvedValue({ status: 'ok', info: info() } satisfies LookupResult);
    createBadges(netflix)(card(1));
    expect(card(1).querySelector('streamrating-badge')?.shadowRoot?.querySelector('.chip .spinner')).not.toBeNull();
    await flush();
    expect(badgeText(card(1))).toContain('IMDb 8.7');
    expect(badgeText(card(1))).toContain('RT 95%');
    expect(card(1).querySelector('.boxart-container streamrating-badge')).not.toBeNull();
    expect(sendMessage).toHaveBeenCalledWith('lookupTitle', { title: 'Stranger Things', platform: 'netflix', platformId: '80057281' });
  });

  it('keeps every badge on a site whose titles do not repeat, whatever "once per film" says', async () => {
    sendMessage.mockResolvedValue({ status: 'ok', info: info() });
    const visit = createBadges(netflix, { oncePerFilm: () => true });
    visit(card(1));
    visit(card(2));
    await flush();
    expect(badgeText(card(1))).toContain('IMDb 8.7');
    expect(badgeText(card(2))).toContain('IMDb 8.7');
  });

  it('asks only once for a card that is visited again', async () => {
    sendMessage.mockResolvedValue({ status: 'ok', info: info() });
    const visit = createBadges(netflix);
    visit(card(1));
    visit(card(1));
    await flush();
    visit(card(1));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(card(1).querySelectorAll('streamrating-badge')).toHaveLength(1);
  });

  it('puts the badge back if the site removed it', async () => {
    sendMessage.mockResolvedValue({ status: 'ok', info: info() });
    const visit = createBadges(netflix);
    visit(card(1));
    await flush();
    card(1).querySelector('streamrating-badge')!.remove();
    visit(card(1));
    expect(card(1).querySelectorAll('streamrating-badge')).toHaveLength(1);
  });

  it('looks the new title up when the site reuses a card for another show', async () => {
    sendMessage.mockResolvedValue({ status: 'ok', info: info() });
    const visit = createBadges(netflix);
    visit(card(1));
    await flush();
    card(1).querySelector('a')!.setAttribute('aria-label', 'Dark');
    visit(card(1));
    await flush();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(card(1).querySelectorAll('streamrating-badge')).toHaveLength(1);
  });

  it('shows nothing for a title that was not found, and a setup chip when the key is missing', async () => {
    const visit = createBadges(netflix);
    sendMessage.mockResolvedValueOnce({ status: 'not_found' });
    visit(card(1));
    await flush();
    expect(badgeText(card(1))).toBe('');
    sendMessage.mockResolvedValueOnce({ status: 'error', kind: 'missing_key', message: 'No key' });
    visit(card(2));
    await flush();
    expect(badgeText(card(2))).toContain('Set up StreamRating');
  });

  it('does not badge a card that says nothing', () => {
    createBadges(netflix)(card(4));
    expect(card(4).querySelector('streamrating-badge')).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('Badge states', () => {
  const draw = (state: Parameters<typeof Badge>[0]['state']) => {
    const el = document.createElement('div');
    render(h(Badge, { state, onEnter: () => {}, onLeave: () => {}, onSetup: () => {} }), el);
    return el.textContent?.replace(/\s+/g, ' ').trim();
  };

  it('falls back to the TMDB score, shows a question mark for a doubtful match', () => {
    expect(draw({ status: 'ready', info: info({ imdbRating: null, rtCritics: null }) })).toBe('TMDB 8.4');
    expect(draw({ status: 'ready', info: info({ confidence: 0.6 }) })).toBe('?');
    expect(draw({ status: 'ready', info: info({ imdbRating: null, rtCritics: null, tmdbRating: null }) })).toBe('No rating');
  });
});

describe('HoverCard', () => {
  const draw = (i: TitleInfo) => {
    sendMessage.mockResolvedValue(null);
    const el = document.createElement('div');
    render(h(HoverCard, { info: i, onEnter: () => {}, onLeave: () => {} }), el);
    return el.textContent?.replace(/\s+/g, ' ') ?? '';
  };

  it('shows the scores, the plot and who made it', () => {
    const text = draw(info());
    expect(text).toContain('Dark');
    expect(text).toContain('2017 · 3 seasons · Drama, Sci-Fi');
    expect(text).toContain('8.7');
    expect(text).toContain('95%');
    expect(text).toContain('A missing child.');
    expect(text).toContain('Created by C');
  });

  it('explains why scores are missing', () => {
    expect(draw(info({ ratingsStatus: 'missing_key', imdbRating: null, rtCritics: null }))).toContain('Add an OMDb key');
    expect(draw(info({ ratingsStatus: 'quota' }))).toContain('daily limit');
    expect(draw(info({ confidence: 0.6 }))).toContain('Not sure this is the right title');
  });
});

describe('the card buttons', () => {
  const NO: TitleState = { watchlisted: false, watched: 'no', episodes: 0 };

  /** Draws the buttons with the background answering `states` in turn; returns the two buttons. */
  const draw = async (first: TitleState, platform: 'netflix' | 'youtube' = 'netflix') => {
    sendMessage.mockImplementation(async (type: string) => (type === 'getTitleState' ? first : null));
    const el = document.createElement('div');
    document.body.append(el);
    await act(() => render(h(CardActions, { info: info(), platform }), el));
    await act(async () => void (await flush()));
    const [watched, watchlist] = Array.from(el.querySelectorAll('button'));
    return { watched: watched!, watchlist: watchlist!, text: (b: Element) => b.textContent?.trim() };
  };

  it('asks the background about the title when the card opens, and waits for the answer', async () => {
    sendMessage.mockImplementation(() => new Promise(() => {}));
    const el = document.createElement('div');
    await act(() => render(h(CardActions, { info: info(), platform: 'netflix' }), el));
    const buttons = Array.from(el.querySelectorAll('button'));
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith('getTitleState', { imdbId: 'tt5753856', tmdbId: 1, type: 'tv', title: 'Dark', year: 2017 });
  });

  it('shows what is already saved', async () => {
    const b = await draw({ watchlisted: true, watched: 'yes', episodes: 0 });
    expect(b.text(b.watched)).toBe('✓ Watched');
    expect(b.text(b.watchlist)).toBe('✓ On watchlist');
    expect(b.watched.getAttribute('aria-pressed')).toBe('true');
  });

  it('Mark watched sends the site it was pressed on', async () => {
    const b = await draw(NO, 'youtube');
    expect(b.text(b.watched)).toBe('Mark watched');
    sendMessage.mockImplementation(async () => ({ watchlisted: false, watched: 'yes', episodes: 0 }));
    await act(() => b.watched.click());
    await act(async () => void (await flush()));
    expect(sendMessage).toHaveBeenCalledWith('setWatched', { title: expect.objectContaining({ tmdbId: 1 }), platform: 'youtube', watched: true });
    expect(b.text(b.watched)).toBe('✓ Watched');
  });

  it('+ Watchlist saves, and a second press removes', async () => {
    const b = await draw(NO);
    expect(b.text(b.watchlist)).toBe('+ Watchlist');
    sendMessage.mockImplementation(async () => ({ ...NO, watchlisted: true }));
    await act(() => b.watchlist.click());
    await act(async () => void (await flush()));
    expect(sendMessage).toHaveBeenCalledWith('setWatchlisted', { title: expect.objectContaining({ tmdbId: 1 }), on: true });
    expect(b.text(b.watchlist)).toBe('✓ On watchlist');
    sendMessage.mockImplementation(async () => NO);
    await act(() => b.watchlist.click());
    await act(async () => void (await flush()));
    expect(sendMessage).toHaveBeenLastCalledWith('setWatchlisted', { title: expect.objectContaining({ tmdbId: 1 }), on: false });
  });

  it('shows played episodes but will not wipe them with a click', async () => {
    const b = await draw({ watchlisted: false, watched: 'episodes', episodes: 3 });
    expect(b.text(b.watched)).toBe('✓ Watched · 3 episodes');
    expect(b.watched.disabled).toBe(true);
  });

  it('is part of the hover card', () => {
    sendMessage.mockResolvedValue(null);
    const el = document.createElement('div');
    render(h(HoverCard, { info: info(), platform: 'netflix' }), el);
    expect(el.querySelector('.actions')).not.toBeNull();
  });
});
