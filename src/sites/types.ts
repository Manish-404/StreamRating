import type { MediaType, Platform } from '../db/types';
import type { MatchQuery } from '../match/types';
import type { SiteId } from '../settings';

export interface NowPlaying {
  title: string;
  type?: MediaType;
  season?: number;
  episode?: number;
  platformId?: string;
}

/**
 * Everything that is specific to one website. The selectors here are the part that breaks when a site
 * is redesigned, so each site lives in its own file and nothing else knows about its markup.
 */
export interface SiteAdapter {
  id: SiteId;
  platform: Platform;
  /** True when this adapter handles the given page address. */
  matches(url: URL): boolean;
  /** Thumbnail elements currently inside root. */
  findCards(root: ParentNode): HTMLElement[];
  /** What the card says it is, or null when it is not a title (a banner, an ad, a placeholder). */
  extract(card: HTMLElement): MatchQuery | null;
  /** The element to put the badge in. */
  anchor(card: HTMLElement): HTMLElement;
  /** The element whose hover opens the card, and that the card sits beside. The whole thumbnail card when absent. */
  hoverTarget?(card: HTMLElement): HTMLElement;
  /**
   * The screen a site opens for one title (Netflix's more-info modal). Returns the title and an element to put
   * the ratings next to, or null when no such screen is open. Must return null on video player pages.
   */
  detail?: {
    find(doc: Document, known: Map<string, MatchQuery>): { query: MatchQuery; anchor: HTMLElement } | null;
    /** CSS for the element holding the chips; by default it sits inline, after the anchor's other contents. */
    hostStyle?: string;
  };
  /**
   * The big featured title at the top of a home page (Netflix's billboard, a different title on each load). Same
   * shape as `detail`; `expected` says on which pages one should be found, so a miss there can be reported.
   */
  billboard?: {
    find(doc: Document, known: Map<string, MatchQuery>): { query: MatchQuery; anchor: HTMLElement } | null;
    hostStyle?: string;
    /** An element in the anchor whose height the ratings box should take, so it lines up with it (the More Info button). */
    fit?(anchor: HTMLElement): HTMLElement | null;
    expected(url: URL): boolean;
    /** The same title again, on the billboard itself: the element to lay a corner badge over. */
    frame?: {
      find(doc: Document, known: Map<string, MatchQuery>): { query: MatchQuery; anchor: HTMLElement } | null;
      hostStyle?: string;
    };
  };
  /** The episode list inside a detail screen: which season, and each row with its episode number. */
  episodes?: {
    find(doc: Document): { season: number; rows: { episode: number; row: HTMLElement }[] } | null;
  };
  player?: {
    isPlayerPage(url: URL): boolean;
    nowPlaying(doc: Document): NowPlaying | null;
  };
}
