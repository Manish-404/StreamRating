import { defineContentScript } from 'wxt/utils/define-content-script';
import { createBadges } from '../../content/badges';
import { createDetail } from '../../content/detail';
import { describeBadge, describeVisibleThumbnails, isRenderable } from '../../content/diagnose';
import { startScanner } from '../../content/scanner';
import { getSettings } from '../../settings';
import { adapterFor } from '../../sites';

export default defineContentScript({
  // Add a site here together with its adapter in src/sites. Torrent domains are registered at runtime instead.
  matches: ['*://*.netflix.com/*', '*://www.youtube.com/*'],
  runAt: 'document_idle',

  async main() {
    const adapter = adapterFor(new URL(location.href));
    if (!adapter) return;
    // A site turned off in Settings takes effect on the next page load.
    if (!(await getSettings()).sites[adapter.id]) return;
    console.info('[StreamRating] content script started on ' + adapter.id + ', build ' + __BUILD_TIME__);
    startScanner(adapter, createBadges(adapter), createDetail(adapter));

    // If nothing shows up, this is the first thing to look at (DevTools console, filter "StreamRating").
    // Sites are single-page apps, so check again after every address change, not just at load.
    const report = () => {
      if (adapter.player?.isPlayerPage(new URL(location.href)) || /^\/watch\//.test(location.pathname)) {
        console.info('[StreamRating] ' + adapter.id + ': video player page, no thumbnails expected here.');
        return;
      }
      const all = adapter.findCards(document);
      const cards = all.filter(isRenderable);
      const found = cards.length;
      if (found > 0) {
        // On YouTube most videos are not about a film and rightly get no badge, so count the ones that are.
        const titled = cards.filter((c) => adapter.extract(c));
        console.info('[StreamRating] ' + adapter.id + ': recognised ' + found + ' visible thumbnails (' + all.length + ' in the page, ' + titled.length + ' of the visible ones name a title) on ' + location.pathname);
        // What the adapter read from the first few, so a silent miss can be diagnosed from one pasted line.
        const sample = (titled.length ? titled : cards).slice(0, 3).map((c, i) => {
          const query = adapter.extract(c);
          return { title: query?.title ?? null, badge: !!c.querySelector('streamrating-badge'), html: query ? undefined : c.outerHTML.slice(0, 900), debug: i === 0 ? describeBadge(c) : undefined };
        });
        console.info('[StreamRating] sample ' + JSON.stringify(sample));
      }
      else console.warn('[StreamRating] ' + adapter.id + ': no visible thumbnails recognised (' + all.length + ' hidden ones found) on ' + location.pathname + '. If thumbnails are visible, the site markup has changed; the selectors live in src/sites/' + adapter.id + '.ts. On screen: ' + JSON.stringify(describeVisibleThumbnails()));
    };
    let lastUrl = location.href;
    let reportTimer = window.setTimeout(report, 4000);
    window.setInterval(() => {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      window.clearTimeout(reportTimer);
      reportTimer = window.setTimeout(report, 4000);
    }, 1000);
  },
});
