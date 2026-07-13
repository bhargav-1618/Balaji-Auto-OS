// components/Modal.js
// ONE shared modal primitive for the whole app. Every dialog should render through
// this so scrolling behaves identically everywhere and future dialogs inherit it.
//
// Why this finally works on iOS Safari / Android where CSS-only attempts failed:
//   * The scroll container's height is the MEASURED window.visualViewport height
//     (a real pixel value), not 100vh / 100dvh / inset:0 — those resolve to the
//     LARGE viewport on iOS (taller than what's visible behind the URL bar), so
//     the bottom of the form ends up off-screen and unreachable. visualViewport
//     is the actual visible area, and it also shrinks when the keyboard opens, so
//     the focused field stays reachable.
//   * Exactly ONE scroll owner: the body. Header and footer are flex-shrink-0;
//     the body is flex-1 + overflow-y-auto. No nested/competing scroll contexts.
//   * Background is locked with a reference-counted position:fixed lock (the only
//     cross-browser-reliable lock), restored cleanly on close.
import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

// ---- reference-counted body scroll lock (iOS-safe) ----
const __tokens = new Set();
let __c = 0;
let __y = 0;
let __tokenSeq = 0;
function lockBody() {
  if (typeof document === 'undefined') return undefined;
  const token = ++__tokenSeq;
  __tokens.add(token);
  if (__c === 0) {
    __y = window.scrollY || window.pageYOffset || 0;
    const b = document.body;
    const h = document.documentElement;
    b.style.position = 'fixed';
    b.style.top = `-${__y}px`;
    b.style.left = '0';
    b.style.right = '0';
    b.style.width = '100%';
    b.style.overflow = 'hidden';
    h.style.overflow = 'hidden';
    h.style.overscrollBehavior = 'none';
  }
  __c += 1;
  // Mark the document so a stranded lock is detectable. This is set by the LOCK
  // itself (not by individual modals), so it can never disagree with the counter.
  document.documentElement.setAttribute('data-scroll-locked', String(__c));
  return token;
}
function unlockBody(token) {
  if (typeof document === 'undefined') return;
  if (token !== undefined) __tokens.delete(token);
  else { const first = __tokens.values().next(); if (!first.done) __tokens.delete(first.value); }
  __c = Math.max(0, __c - 1);
  if (__c === 0) __releaseBody();
  else document.documentElement.setAttribute('data-scroll-locked', String(__c));
}

// Hard release of every inline style the lock applies. Split out so it can also be
// used to recover from a drifted counter (see __assertUnlocked).
function __releaseBody() {
  const b = document.body;
  const h = document.documentElement;
  b.style.position = '';
  b.style.top = '';
  b.style.left = '';
  b.style.right = '';
  b.style.width = '';
  b.style.overflow = '';
  h.style.overflow = '';
  h.style.overscrollBehavior = '';
  h.removeAttribute('data-scroll-locked');
  window.scrollTo(0, __y);
}

// SAFETY NET for a stranded lock.
//
// If a modal ever unmounts without its cleanup running (an error thrown mid-render,
// a hot reload), the counter drifts above zero and the body stays position:fixed
// forever — the page silently refuses to scroll with nothing on screen to explain it.
//
// IMPORTANT: an earlier version of this guard tried to detect "is a modal open?" by
// querying the DOM for modal-ish selectors. That was dangerous: the selectors did not
// actually match our modals, so the guard concluded nothing was open and force-
// unlocked the body WHILE A MODAL WAS STILL UP — making the background scroll behind
// it. We never guess from the DOM now.
//
// Instead the lock owns the truth: every locker registers a token on mount and
// releases it on unmount. If the counter is positive but no live tokens remain, the
// lock is definitively stranded and safe to release.
export function assertBodyUnlockedIfNoModals() {
  if (typeof document === 'undefined') return;
  const locked = document.documentElement.hasAttribute('data-scroll-locked');
  if (locked && __tokens.size === 0) {
    __c = 0;
    __releaseBody();
  }
}

// Track the real visible viewport height (accounts for URL bar AND keyboard).
function useViewportHeight() {
  const [h, setH] = useState(null);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const vv = window.visualViewport;
    const update = () => setH(Math.round(vv?.height ?? window.innerHeight));
    update();
    // iOS Safari's bottom toolbar settles AFTER the modal opens; a single mount
    // measurement can capture the wrong (taller) height. Re-measure on the next
    // frame and again as the toolbar animates, so the panel cap converges to the
    // true visible height even if no resize event fires.
    const raf = requestAnimationFrame(update);
    const t1 = setTimeout(update, 120);
    const t2 = setTimeout(update, 350);
    const t3 = setTimeout(update, 700);
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);
  return h;
}

const SIZES = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-2xl',
};

export default function Modal({
  open = true,
  onClose,
  title,
  header,        // optional custom header node (overrides title row)
  footer,        // optional sticky footer node
  children,      // modal body (the only scrolling region)
  size = 'lg',
  closeOnBackdrop = true,
  bodyClassName = 'p-5 space-y-4',
  panelClassName = '',
}) {
  const vh = useViewportHeight();
  const scrollRef = useRef(null);
  const [dbg, setDbg] = useState('');
  useEffect(() => { const t = lockBody(); return () => unlockBody(t); }, []);
  // Opt-in diagnostic: add ?debug=1 to the URL to see what THIS device reports.
  // Developer-only — never shown to demo or production end users.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (!/[?&]debug=1/.test(window.location.search)) return undefined;
    const tick = () => {
      const el = scrollRef.current;
      const vv = window.visualViewport;
      setDbg(
        `vv=${Math.round(vv?.height || 0)} inner=${window.innerHeight} ` +
        `pos=${document.body.style.position || 'static'} ` +
        `sh=${el?.scrollHeight || 0} ch=${el?.clientHeight || 0} ` +
        `${(el && el.scrollHeight > el.clientHeight) ? 'SCROLLABLE' : 'NOT-SCROLLABLE'}`
      );
    };
    tick();
    const id = setInterval(tick, 400);
    return () => clearInterval(id);
  }, [vh]);
  if (open === false) return null;

  // Cap the height at the SMALLER of the JS-measured px and 100dvh. The browser
  // keeps `dvh` synced to the real viewport automatically (no JS timing gap), so
  // even if visualViewport reports a too-tall value on this device, 100dvh wins
  // and the panel still fits the visible area -> the body scrolls. When the
  // keyboard shrinks the visual viewport below 100dvh, the measured px wins.
  //
  // Older browsers (iOS Safari < 15.4, legacy Android WebView) don't support dvh —
  // and a `min()` containing an unsupported unit makes the WHOLE declaration
  // invalid, which would leave the panel uncapped and unscrollable. So we only use
  // dvh when the browser actually supports it, and otherwise fall back to the
  // JS-measured pixel height (or vh as a last resort).
  const supportsDvh = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('height', '100dvh');
  const cap = supportsDvh
    ? (vh ? `min(${vh}px, 100dvh)` : '100dvh')
    : (vh ? `${vh}px` : '100vh');

  return (
    <div
      className="fixed left-0 top-0 right-0 z-[100] flex items-end justify-center sm:items-center sm:p-4"
      style={{ height: cap, maxHeight: cap, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
      onClick={(e) => closeOnBackdrop && e.target === e.currentTarget && onClose?.()}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-full ${SIZES[size] || SIZES.lg} rounded-t-3xl sm:rounded-2xl flex flex-col min-h-0 ${panelClassName}`}
        style={{ maxHeight: cap, background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.2)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {dbg && (
          <div className="flex-shrink-0 px-3 py-1 font-mono text-[10px] leading-tight text-amber-300 bg-black/70 break-all">{dbg}</div>
        )}
        {/* Sticky header (does not scroll) */}
        {header !== undefined ? (
          header
        ) : title != null ? (
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0">
            <h2 className="text-lg font-bold text-[#d4af37]">{title}</h2>
            {onClose && (
              <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/60 transition">
                <X size={18} />
              </button>
            )}
          </div>
        ) : null}

        {/* The ONLY scroll owner */}
        <div
          ref={scrollRef}
          className={`overflow-y-auto overscroll-contain flex-1 min-h-0 ${bodyClassName}`}
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {children}
        </div>

        {/* Sticky footer (does not scroll), clears the iOS home indicator */}
        {footer != null && (
          <div
            className="flex-shrink-0 border-t border-white/10 px-5 py-3"
            style={{ background: 'var(--surface-1)', paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// Exposed so non-migrated inline sheets can share the exact same lock.
export { lockBody, unlockBody, useViewportHeight };
