import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchQuery } from '../src/match/types';
import { netflix } from '../src/sites/netflix';

// A guess at the more-info modal: a dialog with a title logo and a row holding the Play button.
// Not captured from the live site; the extension logs the real structure when it cannot place the chips.
const MODAL = '<div role="dialog"><img alt="Lost in Space" src="logo.png"><div id="row"><button data-uia="play-button">Play</button><button>+</button></div></div>';

const find = (known = new Map<string, MatchQuery>()) => netflix.detail!.find(document, known);

beforeEach(() => {
  // happy-dom has no layout, so say everything is painted.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 40, top: 0, left: 0, right: 100, bottom: 40, x: 0, y: 0, toJSON: () => ({}) });
  document.body.innerHTML = MODAL;
  window.history.pushState({}, '', '/browse?jbv=80232926');
});

describe('netflix detail screen', () => {
  it('names the title from the thumbnail that was seen, and anchors in the Play button row', () => {
    const known = new Map([['80232926', { title: 'Lost in Space', platform: 'netflix' as const, platformId: '80232926' }]]);
    const found = find(known)!;
    expect(found.query).toEqual({ title: 'Lost in Space', platform: 'netflix', platformId: '80232926' });
    expect(found.anchor.id).toBe('row');
  });

  it('falls back to the title logo inside the dialog', () => {
    expect(find()?.query).toEqual({ title: 'Lost in Space', platform: 'netflix', platformId: '80232926' });
  });

  it('reads the id from a /title/ address too', () => {
    window.history.pushState({}, '', '/title/80232926');
    expect(find()?.query.platformId).toBe('80232926');
  });

  it('does nothing on the video player page', () => {
    window.history.pushState({}, '', '/watch/80232926');
    expect(find()).toBeNull();
  });

  it('does nothing when no title is open or there is no Play button to sit beside', () => {
    window.history.pushState({}, '', '/browse');
    expect(find()).toBeNull();
    window.history.pushState({}, '', '/browse?jbv=80232926');
    document.body.innerHTML = '<div role="dialog"><img alt="x"></div>';
    expect(find()).toBeNull();
  });
});

describe('netflix detail window: film or series from its facts line', () => {
  const open = (facts: string) => {
    window.history.replaceState(null, '', '/title/70218756');
    document.body.innerHTML =
      '<div role="dialog" aria-label="Ted"><img alt="Ted" src="t.png"><div><button data-uia="play-button">Play</button></div>' +
      '<div data-uia="videoMetadata--container">' + facts + '</div></div>';
  };
  it('reads a length as a film, with its year', () => {
    open('<span>2012</span> <span>1h 46m</span> <span>HD</span>');
    expect(netflix.detail!.find(document, new Map())?.query).toMatchObject({ title: 'Ted', type: 'movie', year: 2012 });
  });
  it('reads seasons as a series', () => {
    open('<span>2024</span> <span>1 Season</span>');
    expect(netflix.detail!.find(document, new Map())?.query).toMatchObject({ type: 'tv', year: 2024 });
  });
});
