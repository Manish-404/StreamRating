const short = (el: Element) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
const size = (el: Element) => {
  const r = el.getBoundingClientRect();
  return Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.left) + ',' + Math.round(r.top);
};

/** Says where a badge sits and what is painted on top of it, to find out why a chip cannot be seen. */
export function describeBadge(card: HTMLElement): Record<string, unknown> | null {
  const host = card.querySelector<HTMLElement>('streamrating-badge');
  if (!host) return null;
  const rect = host.getBoundingClientRect();
  const topEl = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  const chain: string[] = [];
  for (let el = host.parentElement, i = 0; el && i < 6; el = el.parentElement, i++) {
    const cs = getComputedStyle(el);
    chain.push(short(el) + ' [' + size(el) + ' pos=' + cs.position + ' overflow=' + cs.overflow + ' z=' + cs.zIndex + ' vis=' + cs.visibility + ' op=' + cs.opacity + ']');
  }
  return {
    chips: host.shadowRoot?.querySelector('div')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    host: size(host),
    topAtBadge: topEl ? short(topEl) : null,
    topIsBadge: topEl === host,
    ancestors: chain,
  };
}

/** True when the element is actually painted: not display:none, not visibility:hidden, and not zero-sized. */
export function isRenderable(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return false;
  return (el as HTMLElement).checkVisibility?.({ visibilityProperty: true }) !== false;
}

const attrs = (el: Element) =>
  ['href', 'role', 'aria-label', 'data-uia', 'title']
    .map((a) => (el.getAttribute(a) ? a + '=' + el.getAttribute(a)!.slice(0, 60) : ''))
    .filter(Boolean)
    .join(' ');

/** When no thumbnail is recognised: what big images and title links are really on screen, with their parents. */
export function describeVisibleThumbnails(): Record<string, unknown> {
  const inView = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width >= 90 && r.height >= 50 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && isRenderable(el);
  };
  const images = Array.from(document.images)
    .filter(inView)
    .slice(0, 3)
    .map((img) => {
      const chain: string[] = [];
      for (let el: Element | null = img, i = 0; el && i < 6; el = el.parentElement, i++) chain.push(short(el) + ' {' + attrs(el) + '}');
      return { alt: img.alt.slice(0, 60), src: img.src.slice(0, 50), size: size(img), chain };
    });
  const links = Array.from(document.querySelectorAll('a[href*="/watch/"], a[href*="/title/"]'))
    .filter(inView)
    .slice(0, 2)
    .map((a) => a.outerHTML.slice(0, 400));
  return { visibleImages: images.length, images, visibleLinks: links.length, links };
}

/** When a detail screen is open but the ratings could not be placed: the data-uia names and dialogs on screen. */
export function describeDetail(): Record<string, unknown> {
  const names = new Set<string>();
  for (const el of document.querySelectorAll('[data-uia]')) {
    if (names.size >= 80) break;
    if (isRenderable(el)) names.add(el.getAttribute('data-uia')!);
  }
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
    .filter(isRenderable)
    .slice(0, 2)
    .map((d) => short(d) + ' {' + attrs(d) + '}');
  const plays = Array.from(document.querySelectorAll('[data-uia="play-button"]')).map((b) => (isRenderable(b) ? 'visible ' : 'hidden ') + size(b));
  return { dataUia: [...names], dialogs, playButtons: plays };
}

const piece = (el: Element): string => {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent?.trim();
    if (t) return t.slice(0, 18);
  }
  return '';
};

/**
 * When a detail screen is open for a series but no episode rows were recognised: the pictures inside the
 * dialog with their parents (and the first text each parent starts with), plus related data-uia names.
 */
export function describeEpisodes(): Record<string, unknown> {
  const scope = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find(isRenderable) ?? document.body;
  const images = Array.from(scope.querySelectorAll('img'))
    .filter((i) => isRenderable(i) && i.getBoundingClientRect().width >= 60)
    .slice(0, 6)
    .map((img) => {
      const chain: string[] = [];
      for (let el: Element | null = img, i = 0; el && el !== scope && i < 8; el = el.parentElement, i++) {
        chain.push(short(el) + ' {' + attrs(el) + '} starts="' + piece(el) + '"');
      }
      return { alt: img.alt.slice(0, 40), size: size(img), chain };
    });
  const names = new Set<string>();
  for (const el of scope.querySelectorAll('[data-uia]')) {
    const n = el.getAttribute('data-uia')!;
    if (/episode|season|title|item|card/i.test(n) && isRenderable(el)) names.add(n);
    if (names.size >= 40) break;
  }
  const seasonTexts: string[] = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n && seasonTexts.length < 4; n = walker.nextNode()) {
    if (/Season/i.test(n.textContent ?? '')) seasonTexts.push((n.textContent ?? '').trim().slice(0, 40));
  }
  return { images, dataUia: [...names], seasonTexts };
}
