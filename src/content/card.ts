import { h, render, type VNode } from 'preact';

// Any card content: a title, an episode.
type View = VNode<any>;
import type { TitleInfo } from '../match/types';
import { HoverCard } from './HoverCard';
import css from './ui.css?inline';

const OPEN_DELAY_MS = 400;
const CLOSE_DELAY_MS = 250;
const GAP = 8;
/**
 * Streaming sites swap a thumbnail for a much larger preview when it is hovered (Netflix's is about twice as
 * wide). The card therefore stays open while the pointer is anywhere in this enlarged area around the thumbnail.
 */
const ZONE_X = 0.8;
const ZONE_Y = 1.0;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Session {
  key: string;
  node: View;
  anchor: HTMLElement;
  zone: Box;
  shown: boolean;
}

let host: HTMLElement | null = null;
let mount: HTMLElement | null = null;
let session: Session | null = null;
let openTimer: number | undefined;
let closeTimer: number | undefined;
let pointer = { x: -1, y: -1 };
let resizeWatch: ResizeObserver | null = null;

const inside = (b: Box, x: number, y: number) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;

function zoneAround(el: HTMLElement): Box {
  const r = el.getBoundingClientRect();
  return { left: r.left - r.width * ZONE_X, right: r.right + r.width * ZONE_X, top: r.top - r.height * ZONE_Y, bottom: r.bottom + r.height * ZONE_Y };
}

/** One card element is shared by every thumbnail on the page, created the first time it is needed. */
function ensureHost(): HTMLElement {
  if (host?.isConnected && mount) return mount;
  host = document.createElement('streamrating-card');
  host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  mount = document.createElement('div');
  shadow.append(style, mount);
  document.documentElement.append(host);
  return mount;
}

function cardBox(): Box | null {
  const card = mount?.firstElementChild as HTMLElement | null;
  if (!card) return null;
  const r = card.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function place(zone: Box, container: HTMLElement): void {
  const card = container.firstElementChild as HTMLElement | null;
  if (!card || !session) return;
  const w = card.offsetWidth;
  const hgt = card.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const a = session.anchor.getBoundingClientRect();

  // Beside the enlarged area, not on top of it; the other side if there is no room.
  let left = zone.right + GAP;
  if (left + w > vw - GAP) left = zone.left - w - GAP;
  if (left < GAP) left = Math.max(GAP, Math.min(a.left, vw - w - GAP));
  const top = Math.max(GAP, Math.min(a.top + a.height / 2 - hgt / 2, vh - hgt - GAP));
  card.style.left = left + 'px';
  card.style.top = top + 'px';
}

function end(): void {
  window.clearTimeout(openTimer);
  window.clearTimeout(closeTimer);
  closeTimer = undefined;
  window.removeEventListener('scroll', end, true);
  session = null;
  resizeWatch?.disconnect();
  resizeWatch = null;
  if (mount) render(null, mount);
}

function onMove(e: MouseEvent): void {
  pointer = { x: e.clientX, y: e.clientY };
  if (!session) return;
  const overCard = (() => {
    const b = cardBox();
    return !!b && inside(b, pointer.x, pointer.y);
  })();
  if (overCard || inside(session.zone, pointer.x, pointer.y)) {
    window.clearTimeout(closeTimer);
    closeTimer = undefined;
  } else if (closeTimer === undefined) {
    closeTimer = window.setTimeout(end, CLOSE_DELAY_MS);
  }
}

function show(): void {
  if (!session) return;
  const container = ensureHost();
  render(session.node, container);
  session.shown = true;
  place(session.zone, container);
  // The review, the poster and the episode plot arrive after the card opens and make it taller:
  // fit it to the screen again each time, so it never runs off the bottom (the card itself then scrolls).
  resizeWatch?.disconnect();
  const el = container.firstElementChild;
  if (el) {
    resizeWatch = new ResizeObserver(() => session && place(session.zone, container));
    resizeWatch.observe(el);
  }
}

/** Opens the card for any content (a title, an episode). The key says whether it is the one already open. */
export function scheduleOpenView(anchor: HTMLElement, key: string, node: View, at?: { x: number; y: number }): void {
  if (at) pointer = at;
  if (session?.anchor === anchor && session.key === key) {
    session.node = node; // same card, fresher data
    return;
  }
  end();
  session = { key, node, anchor, zone: zoneAround(anchor), shown: false };
  // The card is fixed on screen, so it would be left behind by a scroll.
  window.addEventListener('scroll', end, { capture: true, passive: true });
  openTimer = window.setTimeout(() => {
    if (session && inside(session.zone, pointer.x, pointer.y)) show();
    else end();
  }, OPEN_DELAY_MS);
}

/** Call when the pointer enters a thumbnail. The card opens after a short delay if the pointer is still around. */
export function scheduleOpen(anchor: HTMLElement, info: TitleInfo, at?: { x: number; y: number }): void {
  scheduleOpenView(anchor, 'title:' + info.key, h(HoverCard, { info }), at);
}

/** Call when the pointer leaves a thumbnail. Does nothing by itself: a preview covering it also ends a hover. */
export function scheduleClose(): void {
  // The pointer tracking in onMove closes the card once the pointer really leaves the area.
}

// Always know where the pointer is (a pointer resting on a thumbnail sends no further events). Capturing,
// so a site that stops mouse events from bubbling cannot hide them from us.
document.addEventListener('mousemove', onMove, { capture: true, passive: true });
