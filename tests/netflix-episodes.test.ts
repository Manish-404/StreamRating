import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findNetflixEpisodes } from '../src/sites/netflixEpisodes';

// A guess at the episode list: number, thumbnail, then title and runtime. Not captured from the live site.
const LIST = `<div role="dialog"><h2>Episodes</h2><button>Season 2 v</button>
  <div id="r1"><span>1</span><div><img src="a.jpg"></div><div><h3>Pilot</h3><span>50m</span><p>Plot one</p></div></div>
  <div id="r2"><span>2</span><div><img src="b.jpg"></div><div><h3>Protocol 6</h3><span>46m</span></div></div>
  <div id="cast"><img src="c.jpg"><span>Cast: A, B</span></div></div>`;

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 120, height: 40, top: 0, left: 0, right: 120, bottom: 40, x: 0, y: 0, toJSON: () => ({}) });
  document.body.innerHTML = LIST;
  window.history.pushState({}, '', '/browse?jbv=1');
});

describe('findNetflixEpisodes', () => {
  it('finds each episode row by its number and thumbnail, and reads the season', () => {
    const found = findNetflixEpisodes(document)!;
    expect(found.season).toBe(2);
    expect(found.rows.map((r) => [r.episode, r.row.id])).toEqual([[1, 'r1'], [2, 'r2']]);
  });

  it('reads the season from its own text, not from page text run together with the episode number', () => {
    document.body.innerHTML = '<div role="dialog"><button>Season 1</button><div id="r1"><span>1</span><div><img src="a.jpg"></div><h3>Pilot</h3></div></div>';
    expect(findNetflixEpisodes(document)!.season).toBe(1);
    document.body.innerHTML = '<div role="dialog"><b>Season 3:</b><div id="r1"><span>5</span><div><img src="a.jpg"></div><h3>Pilot</h3></div></div>';
    expect(findNetflixEpisodes(document)!.season).toBe(3);
  });

  it('ignores a picture that is not an episode (no number in front of it)', () => {
    expect(findNetflixEpisodes(document)!.rows.some((r) => r.row.id === 'cast')).toBe(false);
  });

  it('returns null when there is no episode list or on the player page', () => {
    document.body.innerHTML = '<div role="dialog"><img src="x.jpg"><span>Movie</span></div>';
    expect(findNetflixEpisodes(document)).toBeNull();
    document.body.innerHTML = LIST;
    window.history.pushState({}, '', '/watch/1');
    expect(findNetflixEpisodes(document)).toBeNull();
  });
});
