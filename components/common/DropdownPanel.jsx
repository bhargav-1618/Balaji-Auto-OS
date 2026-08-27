// components/common/DropdownPanel.jsx
//
// The ONE positioning primitive for every dropdown in the app (Issue 5).
//
// The bug it exists to kill: a dropdown rendered as `absolute` inside its field is
// clipped by ANY ancestor with `overflow: hidden` / `overflow-y: auto`. Billing's
// <Section> is `rounded-xl overflow-hidden`; the invoice body is `overflow-y-auto`.
// So the vehicle list showed one row of five, and the job-card list was cut mid-row.
// No z-index defeats an overflow clip — the node has to leave the subtree entirely.
//
// This renders its children through a PORTAL into <body> at `position: fixed`,
// anchored to the field's bounding rect and re-measured on scroll/resize. It does
// NOT style its children: each dropdown keeps its own rows and its own look, so
// wrapping an existing dropdown in this changes its POSITION and nothing else.
//
// Context lifecycle (Billing Action Menu architecture review) — a portalled panel
// is not a DOM descendant of its anchor, so nothing stops it from silently going
// stale once the anchor moves: an anchor that scrolls behind a sticky header,
// gets covered by a newly opened dialog, or scrolls out of its own container
// entirely used to leave the panel floating at its last-known position with no
// relationship to what's now on screen. Fixed properly, not scroll-event-patched:
// every real scroll ancestor of the anchor is discovered and listened to
// directly (not just a window capture-phase catch-all, which this app's own
// nested sidebar/main scroll shell can slip past — see getScrollAncestors).
// Two DIFFERENT dropdown categories get two different, deliberate responses to
// that movement (see useAnchoredPosition's own comment for the full reasoning):
//   - Contextual menus (ActionMenu, every three-dot menu in the app) pass
//     closeOnScroll — ANY scroll at all, from any source (wheel, trackpad,
//     touch, keyboard Page Up/Down/arrows, programmatic scrollTo), closes the
//     menu immediately. A contextual menu is an extension of the row that
//     opened it; the moment the page has moved under it at all, repositioning
//     it to keep chasing that row is no longer "the same interaction" — it
//     should simply be gone, matching how Linear/GitHub/Notion-style contextual
//     menus behave.
//   - Field-style dropdowns (MiniSelect/TreeSelect/SearchSelect) don't set that
//     flag — they keep tracking their anchor through scroll/resize, which is
//     the correct, established behaviour for a form field's own picker staying
//     open while the page scrolls to bring more of a long form into view.
// A ResizeObserver additionally catches layout shifts that never fire a scroll
// event at all (a collapsing sidebar, content reflow) and always repositions
// (never closes) — that isn't the anchor scrolling away, just its own layout
// settling. On every such reposition, the anchor is also hit-tested against
// what's actually rendered at its own screen position (isAnchorUsable below) as
// a defensive fallback — if something has covered it independent of any
// scroll/resize this code observed, close rather than render on top of it.
import React, { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { createPortal } from 'react-dom';

export const PANEL_Z = 250;   // above the editor (z-100) and inline modals (z-130),
                              // below ConfirmDialog (z-300), which is modal over all.
export const MAX_PANEL_H = 420; // required 350–450 band
const MIN_PANEL_H = 140;
const GAP = 4;

// Issue 1 (Add Vehicle popup architecture review) — `boundaryRef` used to be an
// opt-in prop that every call site had to remember to thread through (only
// CustomersModule.jsx ever did). Every OTHER modal in the app — most visibly
// VehiclesModule's own "Add Vehicle" wizard, and everything built on the shared
// <Modal> — silently fell back to full-viewport math and could render a dropdown
// past its own modal's edge. Rather than auditing every field in every modal
// forever, the nearest ENCLOSING modal shell now provides its own panel ref
// through this context; useAnchoredPosition falls back to it automatically
// whenever a call site doesn't pass an explicit boundaryRef. A future modal needs
// zero per-field wiring to get correctly-contained dropdowns — it only has to
// wrap its own content in <ModalBoundaryContext.Provider value={panelRef}>.
export const ModalBoundaryContext = React.createContext(null);

// `boundaryRef` (Batch 4D Defect 4) — optional explicit override. Every
// measurement below was purely viewport-relative: "room below" was always
// `window.innerHeight - anchor.bottom`, even for a dropdown anchored inside a
// modal that itself ends well short of the browser window's bottom edge. A field
// positioned mid-modal would then compute room reaching past the MODAL's own
// bottom border — and since the panel is a `position: fixed` portal (deliberately
// unclipped by any ancestor's overflow, see the file header), nothing stopped it
// from actually rendering there: past the modal's edge, on top of its own fixed
// footer (Save/Next). Passing the modal's own container as `boundaryRef` clamps
// the room/flip calculation to THAT element's rect instead of the full window.
// An explicit prop always wins; omitted, this now falls back to
// ModalBoundaryContext (see above) instead of the full window.
// Walks up from an element collecting every real scrolling ancestor (auto/scroll/
// overlay overflow, actually scrollable — not just `overflow: hidden`), ending
// with `window`. A capture-phase listener on `window` alone is the usual shortcut
// for "catch scroll from any nested container" and normally works — but it is a
// blanket assumption, not a guarantee, and this app already has a real nested
// scroll shell (the sidebar and the main content pane both scroll independently,
// see the app shell's own `<main class="overflow-y-auto">`). Attaching directly to
// each real ancestor is what production floating-UI implementations do (this is
// the same technique behind Floating UI's own `autoUpdate`) and removes any
// dependency on capture-phase bubbling semantics working exactly as expected in
// every layout this app can compose.
function getScrollAncestors(el) {
  const list = [];
  let node = el?.parentElement;
  while (node && node !== document.body) {
    const cs = getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(cs.overflowY) || /(auto|scroll|overlay)/.test(cs.overflowX)) list.push(node);
    node = node.parentElement;
  }
  return list;
}

// A contextual menu is an extension of the row that opened it — if that row is no
// longer the thing actually visible at its own screen position (scrolled behind a
// sticky table header, covered by a newly-opened modal, scrolled out of its own
// scroll container entirely), the menu must not keep floating there disconnected
// from what the user can see. Hit-testing the anchor's own center point is a
// screen-truth check: it catches every kind of obstruction (a sticky `<thead>`,
// the app shell's sticky bar, a dialog opened on top) without having to enumerate
// each one as a special case. `panelEl` is excluded from counting as an
// obstruction — the menu's own body legitimately sitting near/over its trigger
// (e.g. a flipped-upward menu) is not the anchor becoming inaccessible.
function isAnchorUsable(anchorEl, panelEl) {
  if (!anchorEl || !anchorEl.isConnected) return false;
  const r = anchorEl.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const vw = window.innerWidth || 0, vh = window.innerHeight || 0;
  if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) return false;
  // Not every environment implements hit-testing (jsdom, notably, has no
  // elementFromPoint at all) — fail OPEN here: the anchor is connected, sized,
  // and inside the viewport, which is everything that can be verified without
  // it, so treat it as usable rather than let a missing browser API force every
  // dropdown closed.
  if (typeof document.elementFromPoint !== 'function') return true;
  const cx = Math.min(Math.max(r.left + r.width / 2, 0), vw - 1);
  const cy = Math.min(Math.max(r.top + r.height / 2, 0), vh - 1);
  const hit = document.elementFromPoint(cx, cy);
  if (!hit) return false;
  return hit === anchorEl || anchorEl.contains(hit) || (panelEl && (hit === panelEl || panelEl.contains(hit)));
}

export function useAnchoredPosition(anchorRef, open, maxPanelH = MAX_PANEL_H, overrideWidth, boundaryRef, onClose, panelRef, closeOnScroll = false) {
  const [pos, setPos] = useState(null);
  const ctxBoundaryRef = useContext(ModalBoundaryContext);
  const effectiveBoundaryRef = boundaryRef || ctxBoundaryRef;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const measure = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    // The anchor no longer being the thing visibly at its own position means this
    // menu has lost its context — close it rather than render it somewhere stale
    // or on top of whatever now actually occupies that spot (Expected Behaviour:
    // "System detects anchor movement -> Either Close Menu OR Recalculate
    // Position"). A menu with no onClose (a plain field-style dropdown that isn't
    // wired for it) falls back to the existing reposition-only behaviour.
    if (onCloseRef.current && !isAnchorUsable(el, panelRef?.current)) {
      onCloseRef.current();
      return;
    }
    const r = el.getBoundingClientRect();
    const windowVh = window.innerHeight || 800;
    const vw = window.innerWidth || 1280;
    // top/bottom CSS on a `position: fixed` element are always viewport-relative —
    // that part of the math (below) is intentionally untouched by the boundary.
    // Only the ROOM available (how tall the panel is allowed to grow) is clamped.
    const boundary = effectiveBoundaryRef?.current?.getBoundingClientRect();
    const effBottom = boundary ? Math.min(windowVh, boundary.bottom) : windowVh;
    const effTop = boundary ? Math.max(0, boundary.top) : 0;
    const below = effBottom - r.bottom - GAP - 8;
    const above = r.top - effTop - GAP - 8;
    const flip = below < MIN_PANEL_H && above > below;
    const room = Math.max(MIN_PANEL_H, flip ? above : below);
    // Width defaults to the anchor's own width (unchanged behaviour for every
    // field-style dropdown). A caller may pass `overrideWidth` for anchors that
    // shouldn't dictate panel width themselves (e.g. a small icon-button trigger
    // for a text-heavy menu) — in that case `left` is clamped to keep the WIDER
    // panel fully inside the viewport instead of overflowing past its right edge.
    // This clamp is a no-op whenever the panel already fits (the common case), so
    // it changes nothing for existing callers that don't pass an override.
    const width = overrideWidth ?? r.width;
    const left = Math.max(8, Math.min(r.left, vw - width - 8));
    setPos({
      left,
      width,
      top: flip ? undefined : r.bottom + GAP,
      bottom: flip ? windowVh - r.top + GAP : undefined,
      maxH: Math.min(maxPanelH, room),
    });
  }, [anchorRef, maxPanelH, overrideWidth, effectiveBoundaryRef, panelRef]);

  useEffect(() => {
    if (!open) { setPos(null); return undefined; }
    measure();
    // SCROLL and RESIZE are deliberately handled differently, not the same "just
    // recompute" catch-all:
    //   - Any scroll (mouse wheel, trackpad, touch, keyboard Page Up/Down/arrows,
    //     programmatic scrollTo) closes immediately when closeOnScroll is set
    //     (ActionMenu's three-dot menus — see that file). A contextual menu is an
    //     extension of the row that opened it; once the page or table has moved
    //     under it at all, it is no longer unambiguously "this row's menu" and
    //     should not linger, repositioned or not. Field-style dropdowns
    //     (MiniSelect/TreeSelect/SearchSelect) don't set this — they keep
    //     tracking their anchor, since a form field's own dropdown staying open
    //     while the page scrolls to bring more of a long form into view is the
    //     established, correct behaviour there.
    //   - Resize (window resize, visualViewport resize, a ResizeObserver catching
    //     a collapsing sidebar or content reflow that never fires scroll/resize
    //     at all) always repositions — a resize doesn't disconnect the menu from
    //     its row the way scrolling the row out from under it does.
    const onScroll = (e) => {
      // A scroll event whose TARGET is the panel's own scrollable body (Issue: "3-dot
      // menu closes when scrolling inside it to reach lower options") is the user
      // scrolling the menu's own overflowing content — not the page/table moving out
      // from under the anchor. `window`'s capture-phase listener below sees scroll
      // events from every descendant, including the panel's own internal scroll
      // (scroll events propagate through capture even though they don't bubble), so
      // without this check every internal scroll was misread as "the outer page
      // scrolled" and closed the menu before the user could reach anything below the
      // fold. The panel already scrolls its own content natively via `overflow-y:
      // auto` (see the style below) — nothing else needs to happen for that scroll.
      // `e.target` is `window` itself (not a Node) for a scroll event dispatched
      // directly on window — Node.contains() throws on a non-Node argument, so this
      // must be verified before calling it, not just truthiness-checked.
      if (panelRef?.current && e?.target instanceof Node && panelRef.current.contains(e.target)) return;
      if (closeOnScroll && onCloseRef.current) { onCloseRef.current(); return; }
      measure();
    };
    const onResize = () => measure();
    // Capture phase on window is the defensive catch-all (cheap, and correctly
    // catches most nested scrolling in practice). The direct listeners on each
    // real scroll ancestor below are the actual fix: they don't depend on that
    // catch-all firing at all, so this works even in a layout where it doesn't
    // (this app's own sidebar/main split shell being exactly that case).
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    const scrollAncestors = getScrollAncestors(anchorRef.current);
    scrollAncestors.forEach((n) => n.addEventListener('scroll', onScroll, { passive: true }));
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(onResize);
      if (anchorRef.current) ro.observe(anchorRef.current);
      scrollAncestors.forEach((n) => ro.observe(n));
    }
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      scrollAncestors.forEach((n) => n.removeEventListener('scroll', onScroll));
      ro?.disconnect();
    };
  }, [open, measure, anchorRef, closeOnScroll, panelRef]);

  return pos;
}

/**
 * Close `open` when a pointerdown lands outside BOTH the anchor and the portalled
 * panel. The panel is not a DOM descendant of the anchor any more, so a naive
 * "outside the wrapper" check would treat clicking a row as an outside click.
 */
export function useOutsideClose(anchorRef, panelRef, open, onClose) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      const inAnchor = anchorRef.current && anchorRef.current.contains(e.target);
      const inPanel = panelRef.current && panelRef.current.contains(e.target);
      if (!inAnchor && !inPanel) onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, onClose, anchorRef, panelRef]);
}

export default function DropdownPanel({
  anchorRef,
  open,
  children,
  onClose,
  maxHeight = MAX_PANEL_H,
  scroll = true,          // internal scrolling when the content overflows
  className = '',
  style = {},
  panelRef: externalRef,
  // Optional fixed panel width in px, for anchors that shouldn't dictate their
  // own dropdown's width (e.g. a small icon-button trigger for a text menu).
  // Omitted everywhere else — every existing call site keeps matching its
  // anchor's width exactly as before.
  width,
  // Optional ref to the nearest bounded container (typically a modal's own root),
  // so this panel's available height is clamped to THAT element instead of the
  // full browser viewport — see useAnchoredPosition above. Omitted everywhere
  // else, unchanged behaviour.
  boundaryRef,
  // Close immediately on ANY scroll instead of tracking the anchor — set by
  // ActionMenu (every three-dot contextual menu in the app), unset by every
  // field-style dropdown. See useAnchoredPosition's own comment for why these
  // two dropdown categories deliberately behave differently here.
  closeOnScroll = false,
}) {
  const innerRef = useRef(null);
  const panelRef = externalRef || innerRef;
  const pos = useAnchoredPosition(anchorRef, open, maxHeight, width, boundaryRef, onClose, panelRef, closeOnScroll);
  useOutsideClose(anchorRef, panelRef, open, onClose || (() => {}));

  // Esc closes — every dropdown, identically (Issue 5).
  useEffect(() => {
    if (!open || !onClose) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open || !pos || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={panelRef}
      data-dropdown-panel=""
      className={`rounded-xl shadow-2xl ${className}`}   /* entry animation: see globals.css */
      style={{
        position: 'fixed',   // inline, not a Tailwind class — this is load-bearing
        zIndex: PANEL_Z,
        left: pos.left,
        width: pos.width,
        ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
        maxHeight: pos.maxH,
        overflowY: scroll ? 'auto' : 'hidden',
        overscrollBehavior: 'contain',
        WebkitOverflowScrolling: 'touch',
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
