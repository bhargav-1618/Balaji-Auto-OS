/**
 * lib/appScroll.js — single source of truth for "who owns the page scroll".
 *
 * The application shell is a non-scrolling, viewport-height container: the demo banner,
 * header, sidebar and status bar live in it and therefore cannot move. The ONLY element
 * that scrolls is the centre content area (<main id="app-scroll">).
 *
 * Because of that, `window.scrollY` is always 0 and `window.scrollTo()` is a no-op —
 * every scroll read/write must go through the container instead. These helpers keep that
 * detail in one place and fall back to the window if the container isn't mounted yet
 * (e.g. during the boot splash, or on a page that doesn't render the shell).
 */
export const APP_SCROLL_ID = 'app-scroll';

export function getAppScroller() {
  if (typeof document === 'undefined') return null;
  return document.getElementById(APP_SCROLL_ID);
}

/** Scroll the content area. Accepts the same options object as window.scrollTo. */
export function appScrollTo(options) {
  const el = getAppScroller();
  const opts = typeof options === 'number' ? { top: options } : (options || { top: 0 });
  if (el) { el.scrollTo(opts); return; }
  if (typeof window !== 'undefined') window.scrollTo(opts);
}

/** Current scroll offset of the content area. */
export function appScrollY() {
  const el = getAppScroller();
  if (el) return el.scrollTop;
  return typeof window !== 'undefined' ? window.scrollY || 0 : 0;
}

/** Subscribe to content-area scroll. Returns an unsubscribe function. */
export function onAppScroll(handler) {
  const target = getAppScroller() || (typeof window !== 'undefined' ? window : null);
  if (!target) return () => {};
  target.addEventListener('scroll', handler, { passive: true });
  return () => target.removeEventListener('scroll', handler);
}
