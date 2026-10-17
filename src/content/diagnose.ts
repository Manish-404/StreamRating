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

/**
 * When a home page shows no recognised billboard: the Play buttons with their parents, and what the first section
 * of the page holds (pictures with their alt and title, headings, labels, data-uia names, title links, text).
 */
export function describeBillboard(): Record<string, unknown> {
  const chainOf = (start: Element, depth: number) => {
    const chain: string[] = [];
    for (let el: Element | null = start, i = 0; el && el !== document.body && i < depth; el = el.parentElement, i++) chain.push(short(el) + ' {' + attrs(el) + '}');
    return chain;
  };
  const plays = Array.from(document.querySelectorAll('[data-uia*="play" i], button, a[href*="/watch/"]'))
    .filter((b) => b.matches('[data-uia*="play" i]') || /^play\b/i.test((b.textContent ?? '').trim() || b.getAttribute('aria-label') || ''))
    .slice(0, 4)
    .map((b) => ({ visible: isRenderable(b), size: size(b), text: (b.textContent ?? '').trim().slice(0, 30), chain: chainOf(b, 7) }));
  const section = Array.from(document.querySelectorAll('[data-uia="billboard"], section')).find(isRenderable);
  if (!section) return { playButtons: plays, firstSection: null };
  const names = new Set<string>();
  for (const el of section.querySelectorAll('[data-uia]')) if (names.size < 30) names.add(el.getAttribute('data-uia')!);
  const html = (sel: string) => section.querySelector(sel)?.outerHTML.replace(/\s+/g, ' ').slice(0, 1200) ?? null;
  return {
    titleHtml: html('[data-uia="billboard-title"]'),
    actionsHtml: html('[data-uia="billboard-actions"]'),
    playButtons: plays,
    firstSection: {
      chain: chainOf(section, 4),
      size: size(section),
      images: Array.from(section.querySelectorAll('img'))
        .slice(0, 6)
        .map((i) => short(i) + ' alt="' + i.alt.slice(0, 50) + '" title="' + (i.getAttribute('title') ?? '').slice(0, 50) + '" ' + size(i)),
      headings: Array.from(section.querySelectorAll('h1, h2, h3, h4, [role="heading"]')).slice(0, 4).map((e) => (e.textContent ?? '').trim().slice(0, 60)),
      labels: Array.from(section.querySelectorAll('[aria-label]')).slice(0, 8).map((e) => short(e) + ': ' + e.getAttribute('aria-label')!.slice(0, 60)),
      dataUia: [...names],
      links: Array.from(section.querySelectorAll('a[href]')).slice(0, 4).map((a) => a.getAttribute('href')!.slice(0, 60)),
      text: (section.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
    },
  };
}

/** When a title dialog shows "More Like This" but no tile was recognised: the pictures after that heading, with parents. */
export function describeMoreLikeThis(): Record<string, unknown> {
  const dialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find(isRenderable);
  if (!dialog) return { dialog: false };
  let header: Element | null = null;
  const walker = document.createTreeWalker(dialog, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n && !header; n = walker.nextNode()) if (/^\s*more like this\s*$/i.test(n.textContent ?? '')) header = n.parentElement;
  if (!header) return { dialog: true, header: null };
  const images = Array.from(dialog.querySelectorAll('img'))
    .filter((i) => header!.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING)
    .slice(0, 3)
    .map((img) => {
      const chain: string[] = [];
      for (let el: Element | null = img, i = 0; el && el !== dialog && i < 7; el = el.parentElement, i++) chain.push(short(el) + ' {' + attrs(el) + '} starts="' + piece(el) + '"');
      return { alt: img.alt.slice(0, 40), size: size(img), chain };
    });
  return { header: short(header), images };
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
