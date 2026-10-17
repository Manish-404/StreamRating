import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchQuery } from '../src/match/types';
import { netflix } from '../src/sites/netflix';

// The classic billboard markup: a title logo with alt text and a Play link to the player.
const CLASSIC =
  '<div class="billboard-row"><div class="billboard"><div class="info"><div class="billboard-title"><img class="title-logo" alt="Squid Game" src="l.png"></div>' +
  '<div id="row" class="billboard-links"><a class="playLink" href="/watch/81040344"><button data-uia="play-button">Play</button></a>' +
  '<button data-uia="billboard-more-info">More Info</button></div></div></div></div>';

// Shaped like the current layout (the page is a list of sections, the billboard the first; generated class names;
// the logo's alt is empty, as it is in the live title dialog) with the name only on the backdrop picture.
const SECTIONS =
  '<section class="default-ltr-x-cache-1"><div><section class="default-ltr-x-cache-2">' +
  '<img class="default-ltr-x-cache-3" alt="Lost in Space" src="b.jpg"><div><img alt="" src="logo.png"></div>' +
  '<div id="row"><button data-uia="play-button">Play</button><button>More info</button></div></section></div></section>' +
  '<section><a data-uia="standard-card" href="/browse?jbv=70143836" aria-label="Breaking Bad"><img alt="" src="c.jpg"></a></section>';

const find = (known = new Map<string, MatchQuery>()) => netflix.billboard!.find(document, known);

beforeEach(() => {
  // happy-dom has no layout, so say everything is painted.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 40, top: 0, left: 0, right: 100, bottom: 40, x: 0, y: 0, toJSON: () => ({}) });
  window.history.pushState({}, '', '/browse');
});

describe('netflix billboard', () => {
  it('reads the classic billboard: logo name, id from the Play link, chips in the Play row', () => {
    document.body.innerHTML = CLASSIC;
    const found = find()!;
    expect(found.query).toEqual({ title: 'Squid Game', platform: 'netflix', platformId: '81040344' });
    expect(found.anchor.id).toBe('row');
  });

  it('prefers the name of a thumbnail with the same id', () => {
    document.body.innerHTML = CLASSIC;
    const known = new Map([['81040344', { title: 'Squid Game: The Challenge', platform: 'netflix' as const, platformId: '81040344' }]]);
    expect(find(known)?.query.title).toBe('Squid Game: The Challenge');
  });

  it('reads a section-based billboard whose name is only on the backdrop, without reaching the rows below', () => {
    document.body.innerHTML = SECTIONS;
    const found = find()!;
    expect(found.query).toEqual({ title: 'Lost in Space', platform: 'netflix' });
    expect(found.anchor.id).toBe('row');
  });

  it('takes the name from a "Play <title>" label when no picture names it', () => {
    document.body.innerHTML = '<section><div id="row"><button data-uia="play-button" aria-label="Play Dark">Play</button></div></section>';
    expect(find()?.query.title).toBe('Dark');
  });

  it('gives up rather than take a name from the rows of thumbnails', () => {
    document.body.innerHTML =
      '<div><section><div id="row"><button data-uia="play-button">Play</button></div></section>' +
      '<section><a data-uia="standard-card" href="/browse?jbv=1" aria-label="Breaking Bad"><img alt="Breaking Bad" src="c.jpg"></a></section></div>';
    expect(find()).toBeNull();
  });

  it("ignores the Play buttons of the title dialog and of a hovered thumbnail's preview", () => {
    document.body.innerHTML =
      '<div role="dialog"><img alt="Dark"><div><button data-uia="play-button">Play</button></div></div>' +
      '<div class="previewModal--container mini-modal"><img alt="Ozark"><div><button data-uia="play-button">Play</button></div></div>';
    expect(find()).toBeNull();
  });

  it('is only looked for on home and genre pages', () => {
    document.body.innerHTML = CLASSIC;
    expect(netflix.billboard!.expected(new URL('https://www.netflix.com/browse'))).toBe(true);
    expect(netflix.billboard!.expected(new URL('https://www.netflix.com/browse/genre/83'))).toBe(true);
    expect(netflix.billboard!.expected(new URL('https://www.netflix.com/browse/my-list'))).toBe(false);
    window.history.pushState({}, '', '/watch/81040344');
    expect(find()).toBeNull();
  });

  it('leaves the billboard row to the billboard when the title dialog is open over it', () => {
    document.body.innerHTML =
      CLASSIC + '<div role="dialog"><img alt="Lost in Space"><div id="modal-row"><button data-uia="play-button">Play</button></div></div>';
    window.history.pushState({}, '', '/browse?jbv=80232926');
    expect(netflix.detail!.find(document, new Map())?.anchor.id).toBe('modal-row');
    expect(find()?.anchor.id).toBe('row');
  });
});

describe('netflix billboard corner badge', () => {
  it('lays over the whole featured section, not just the Play row, and keeps the id for the dialog', () => {
    document.body.innerHTML = '<section id="frame">' + CLASSIC + '</section><section><a data-uia="standard-card" href="/browse?jbv=70143836" aria-label="Breaking Bad"><img alt="" src="c.jpg"></a></section>';
    const known = new Map<string, MatchQuery>();
    const found = netflix.billboard!.frame!.find(document, known)!;
    expect(found.anchor.id).toBe('frame');
    expect(found.query.title).toBe('Squid Game');
    expect(known.get('81040344')?.title).toBe('Squid Game');
  });
});

describe('netflix More Like This tiles', () => {
  const MODAL = (tiles: string) => '<div role="dialog"><img alt="Dark" src="a.jpg"><div id="eps"><img src="e1.jpg"><span>Pilot</span></div><h3>More Like This</h3><div>' + tiles + '</div></div>';

  it('finds tiles by name when Netflix names them, and reads the name from inside', () => {
    document.body.innerHTML = MODAL('<div id="t1" data-uia="titleCard--container"><img src="x.jpg"><div class="titleCard-title_text">Ozark</div></div>');
    expect(netflix.findCards(document).map((c) => c.id)).toEqual(['t1']);
    expect(netflix.extract(document.getElementById('t1')!)).toMatchObject({ title: 'Ozark', platform: 'netflix' });
  });

  it('otherwise takes the pictures after the heading, not the episode list or the dialog artwork', () => {
    document.body.innerHTML = MODAL('<div id="t1"><img alt="Mindhunter" src="x.jpg"></div><div id="t2"><img alt="Narcos" src="y.jpg"></div>');
    expect(netflix.findCards(document).map((c) => c.id)).toEqual(['t1', 't2']);
    expect(netflix.extract(document.getElementById('t2')!)?.title).toBe('Narcos');
  });

  it('finds nothing when the dialog has no such heading', () => {
    document.body.innerHTML = '<div role="dialog"><img alt="Dark" src="a.jpg"><div id="eps"><img src="e1.jpg"></div></div>';
    expect(netflix.findCards(document)).toEqual([]);
  });
});

describe('netflix billboard by its own data-uia names', () => {
  const LIVE = (logo: string) =>
    '<div data-uia="billboard" id="bb"><div data-uia="billboard-title"><div data-uia="billboard-logo">' + logo + '</div></div><div data-uia="billboard-synopsis">Family pressure sends Aditya to London.</div>' +
    '<div data-uia="billboard-actions" id="acts"><button data-uia="play-video-button">Play</button><button data-uia="billboard-more-info">More Info</button></div></div>';

  it('puts the chips in billboard-actions, the corner badge on the billboard, and reads the logo name', () => {
    document.body.innerHTML = LIVE('<img alt="Epic Classic" src="l.png">');
    expect(find()?.query.title).toBe('Epic Classic');
    expect(find()?.anchor.id).toBe('acts');
    expect(netflix.billboard!.frame!.find(document, new Map())?.anchor.id).toBe('bb');
  });

  it('gives up (and logs) when the logo carries no name', () => {
    document.body.innerHTML = LIVE('<img alt="" src="l.png">');
    expect(find()).toBeNull();
  });
});
