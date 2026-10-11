import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { adapterFor } from '../src/sites';
import { netflix } from '../src/sites/netflix';

beforeEach(() => {
  document.body.innerHTML = readFileSync('tests/fixtures/netflix-browse.html', 'utf8');
});

const card = (n: number) => document.getElementById('card-' + n)!;

describe('netflix adapter', () => {
  it('claims netflix.com pages only', () => {
    expect(adapterFor(new URL('https://www.netflix.com/browse'))?.id).toBe('netflix');
    expect(adapterFor(new URL('https://netflix.com/'))?.id).toBe('netflix');
    expect(adapterFor(new URL('https://notnetflix.com/'))).toBeUndefined();
    expect(adapterFor(new URL('https://example.com/netflix.com'))).toBeUndefined();
  });

  it('finds every thumbnail', () => {
    expect(netflix.findCards(document).map((c) => c.id)).toEqual(['card-1', 'card-2', 'card-3', 'card-4', 'card-5', 'card-6']);
  });

  it('reads the title and Netflix id from the link', () => {
    expect(netflix.extract(card(1))).toEqual({ title: 'Stranger Things', platform: 'netflix', platformId: '80057281' });
    expect(netflix.extract(card(2))).toEqual({ title: 'Breaking Bad', platform: 'netflix', platformId: '70143836' });
  });

  it('falls back to the placeholder text when there is no link', () => {
    expect(netflix.extract(card(3))).toEqual({ title: 'Dark', platform: 'netflix', platformId: undefined });
  });

  it('also finds a thumbnail that has no .title-card wrapper, but not a plain text link', () => {
    expect(netflix.extract(card(5))).toEqual({ title: 'Squid Game', platform: 'netflix', platformId: '81001887' });
    expect(netflix.findCards(document).some((c) => c.id === 'not-card')).toBe(false);
    expect(netflix.anchor(card(5))).toBe(card(5));
  });

  it('reads the current Netflix thumbnail: a standard-card link with the id in jbv=', () => {
    expect(netflix.extract(card(6))).toEqual({ title: 'Teach You a Lesson', platform: 'netflix', platformId: '81947300' });
    expect(netflix.anchor(card(6))).toBe(card(6));
  });

  it('skips a card that says nothing about what it is', () => {
    expect(netflix.extract(card(4))).toBeNull();
  });

  it('puts the badge on the artwork', () => {
    expect(netflix.anchor(card(1)).className).toBe('boxart-container');
  });
});
