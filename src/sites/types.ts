import type { Platform } from '../db/types';
import type { MatchQuery } from '../match/types';
import type { SiteId } from '../settings';

/** What the player page is playing right now. */
export interface NowPlaying {
  /** The site's id for it, so the watcher notices when the video changes. */
  id: string;
  /** What to look up to find the title. */
  query: MatchQuery;
  /** Set for an episode of a series. */
  season?: number;
  episode?: number;
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
  /**
   * True when one title fills many thumbnails (YouTube: the film, its trailers, its teasers), so the "once per film"
   * setting applies: only the first thumbnail of a title on the page keeps its badge.
   */
  repeats?: boolean;
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
  /**
   * The video player page, for the watch history. Nothing here may change the page: it only reads what is playing.
   */
  player?: {
    isPlayerPage(url: URL): boolean;
    /** What is playing, or null while the player has not said (Netflix hides the title until the controls show). */
    nowPlaying(doc: Document, known: Map<string, MatchQuery>): NowPlaying | null;
    /** True when every video on this player is named by the page, so not finding the name means the markup changed (Netflix). */
    reportUnreadable?: boolean;
    /** True while an advert is playing in the player: it must not count as watching. */
    adPlaying?(doc: Document): boolean;
    /** A video this short or shorter is a trailer, not the title (YouTube); absent when the site has no trailers in its player. */
    trailerMaxSeconds?: number;
  };
}
