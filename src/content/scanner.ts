import type { SiteAdapter } from '../sites/types';
import { isRenderable } from './diagnose';

const RESCAN_DEBOUNCE_MS = 300;

/**
 * Watches the page for thumbnails. `visit` is called for a card when it scrolls into view and again after
 * every page change while it stays visible, so it must be cheap and safe to repeat. Returns a stop function.
 */
export function startScanner(adapter: SiteAdapter, visit: (card: HTMLElement) => void, onScan?: () => void): () => void {
  const known = new WeakSet<HTMLElement>();
  const visible = new Set<HTMLElement>();

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        if (entry.isIntersecting) {
          visible.add(el);
          if (isRenderable(el)) visit(el);
        } else {
          visible.delete(el);
        }
      }
    },
    { rootMargin: '150px' },
  );

  const scan = () => {
    for (const card of adapter.findCards(document)) {
      if (!known.has(card)) {
        known.add(card);
        io.observe(card);
      }
    }
    for (const el of visible) {
      if (el.isConnected) {
        if (isRenderable(el)) visit(el);
      } else {
        visible.delete(el);
        io.unobserve(el);
      }
    }
    onScan?.();
  };

  let timer: number | undefined;
  const mo = new MutationObserver(() => {
    if (timer === undefined) {
      timer = window.setTimeout(() => {
        timer = undefined;
        scan();
      }, RESCAN_DEBOUNCE_MS);
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  scan();
  // A card can become painted (a panel opens, a row scrolls in) without any element being added.
  const poll = window.setInterval(scan, 1500);

  return () => {
    mo.disconnect();
    io.disconnect();
    window.clearTimeout(timer);
    window.clearInterval(poll);
  };
}
