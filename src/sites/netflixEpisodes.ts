import { isRenderable } from '../content/diagnose';

/** First piece of visible text inside an element, in document order. */
function firstText(el: Element): string {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent?.trim();
    if (t) return t;
  }
  return '';
}

/** The season shown, from a text piece that starts with "Season N" (the selector, or the "Season N:" label). */
function seasonShown(scope: HTMLElement): number {
  // Piece by piece: the page's joined text would run "Season 1" into the episode number 1 and read 11.
  const walker = scope.ownerDocument.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const m = /^\s*Season\s+(\d+)/.exec(n.textContent ?? '');
    if (m) return Number(m[1]);
  }
  return 1;
}

/**
 * The episode list of a title's detail screen, found without relying on class names: an episode row is the
 * smallest element that holds a thumbnail and starts with its episode number (as in "1  [picture]  Pilot  50m").
 * The season is read from the "Season N" text of the selector or the "Season N:" label.
 */
export function findNetflixEpisodes(doc: Document): { season: number; rows: { episode: number; row: HTMLElement }[] } | null {
  if (doc.location.pathname.startsWith('/watch')) return null;
  const scope = Array.from(doc.querySelectorAll<HTMLElement>('[role="dialog"]')).find(isRenderable) ?? doc.body;

  const rows: { episode: number; row: HTMLElement }[] = [];
  const seen = new Set<HTMLElement>();
  for (const img of scope.querySelectorAll('img')) {
    if (!isRenderable(img) || img.getBoundingClientRect().width < 90) continue;
    let el: HTMLElement | null = img.parentElement;
    for (let depth = 0; el && el !== scope && depth < 7; el = el.parentElement, depth++) {
      const first = firstText(el);
      if (/^\d{1,3}$/.test(first)) {
        if (!seen.has(el)) {
          seen.add(el);
          rows.push({ episode: Number(first), row: el });
        }
        break;
      }
    }
  }
  if (rows.length === 0) return null;
  return { season: seasonShown(scope), rows };
}
