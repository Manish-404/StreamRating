import { describe, expect, it } from 'vitest';
import { COMPLETE_FRACTION, createWatchTracker, type Sample, type WatchEvent } from '../src/content/watchTracker';

/** Plays `seconds` of video one second at a time, from `from`, and returns the first event and all events. */
function play(tracker: ReturnType<typeof createWatchTracker>, from: number, seconds: number, duration: number, playing = true) {
  const events: WatchEvent[] = [];
  for (let t = 0; t <= seconds; t++) {
    const s: Sample = { position: from + t, duration, playing };
    const e = tracker.sample(s);
    if (e) events.push(e);
  }
  return events;
}

const FILM = 2 * 3600;

describe('watch tracker', () => {
  it('says nothing until five minutes have really been played', () => {
    const t = createWatchTracker();
    expect(play(t, 0, 290, FILM)).toEqual([]);
    const events = play(t, 290, 20, FILM);
    expect(events[0]?.progress).toBeCloseTo(300 / FILM, 3);
  });

  it('counts a short video by its share of the runtime: 15% of a 20 minute episode is 3 minutes', () => {
    const t = createWatchTracker();
    expect(play(t, 0, 170, 20 * 60)).toEqual([]);
    expect(play(t, 170, 20, 20 * 60).length).toBeGreaterThan(0);
  });

  it('does not count pausing', () => {
    const t = createWatchTracker();
    play(t, 100, 10_000, FILM, false);
    expect(t.played).toBe(0);
  });

  it('does not count seeking: skipping to the end of a film is not watching it', () => {
    const t = createWatchTracker();
    t.sample({ position: 0, duration: FILM, playing: true });
    t.sample({ position: 6000, duration: FILM, playing: true }); // jump
    t.sample({ position: 6001, duration: FILM, playing: true });
    expect(t.played).toBe(1);
    expect(t.sample({ position: 6900, duration: FILM, playing: true })).toBeNull();
  });

  it('saves again as the film goes on, and marks it finished at 90% after really watching', () => {
    const t = createWatchTracker();
    const first = play(t, 0, 400, FILM);
    expect(first).toHaveLength(1);
    // Watch a stretch, then skip near the end and play on: finished.
    const rest = play(t, FILM * COMPLETE_FRACTION - 5, 20, FILM);
    expect(rest.some((e) => e.complete)).toBe(true);
    expect(rest.filter((e) => e.complete)).toHaveLength(1);
  });

  it('reports the furthest point reached, and flush gives the last word once', () => {
    const t = createWatchTracker();
    play(t, 0, 400, FILM); // saved at the 5 minute mark
    t.sample({ position: 401, duration: FILM, playing: true });
    t.sample({ position: 402, duration: FILM, playing: false });
    const last = t.flush();
    expect(last?.progress).toBeCloseTo(402 / FILM, 3);
    expect(t.flush()).toBeNull();
  });

  it('flush is silent for something that never counted as watched', () => {
    const t = createWatchTracker();
    play(t, 0, 60, FILM);
    expect(t.flush()).toBeNull();
  });

  it('ignores a video whose length is not known yet', () => {
    const t = createWatchTracker();
    expect(play(t, 0, 400, NaN)).toEqual([]);
  });

  it('counts a trailer after half a minute', () => {
    const t = createWatchTracker({ trailer: true });
    expect(play(t, 0, 25, 150)).toEqual([]);
    expect(play(t, 25, 10, 150).length).toBeGreaterThan(0);
  });

  it('counts a teaser shorter than a minute once half of it has played', () => {
    const t = createWatchTracker({ trailer: true });
    expect(play(t, 0, 8, 20)).toEqual([]);
    expect(play(t, 8, 4, 20).length).toBeGreaterThan(0);
  });
});
