// components/common/ResizablePanes.jsx
//
// THE shared resizable-workspace primitive (Suppliers 3-pane workspace review) — this
// app had NO drag-resize implementation anywhere before this (grepped for onMouseDown/
// onPointerDown/cursor-col-resize/splitter/etc. — nothing). Built here, in components/
// common/, rather than inline in SupplierDirectory.jsx, so the next master-detail-style
// workspace that needs user-adjustable panes (this app already has the 2-pane list+
// DetailsPanel shape in Customers/Vehicles, currently a fixed flex-ratio, not draggable)
// can reuse this instead of growing a second, slightly-different drag implementation.
//
// Scope: the fixed-flexible-fixed 3-pane shape (outer panes are user-resizable to a
// px width within [min,max]; the center pane is whatever's left, itself bounded by its
// own [min,max]) — this is the shape Suppliers needs (Directory | Supplier View |
// Purchase Order) and is also the most common resizable-workspace shape generally
// (e.g. an editor's sidebar–content–panel layout). Not a fully generic N-pane splitter
// — nothing in this app needs that yet; extend deliberately if/when something does,
// rather than generalizing ahead of a real second caller.
//
// Performance (Issue 20 requirement: "do not cause expensive re-renders during every
// pointer movement"): during an active drag, the dragged pane's width is written
// directly to the DOM via a ref (bypassing React entirely) — the browser's own flex
// layout recomputes the OTHER (center) pane's width live with zero JS involvement,
// since it's a plain `flex: 1 1 auto`. React state is only committed once, on
// pointerup, so a drag that fires 100+ pointermove events causes exactly one re-render,
// not 100.
//
// Persistence: deliberately NONE. Pane widths live in plain `useState` in the CALLER
// (passed in as `leftWidth`/`rightWidth`/setters) — when the caller unmounts (e.g. the
// user leaves the Suppliers tab) that state is gone, and a fresh mount (tab return, or
// a page reload) starts from the caller's own default widths again. This is exactly the
// "resets on reload or leaving the module, persists through everything else within the
// session" behaviour the brief asks for, and it falls out for free from ordinary React
// component lifetime — no sessionStorage/localStorage plumbing needed or wanted here.
import React, { useCallback, useRef } from 'react';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function Splitter({ onDragStart, orientation = 'vertical', label }) {
  const onKeyDown = (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); onDragStart(null, -16); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); onDragStart(null, 16); }
  };
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      tabIndex={0}
      onPointerDown={onDragStart}
      onKeyDown={onKeyDown}
      className="hidden xl:flex relative flex-shrink-0 w-3 cursor-col-resize items-stretch justify-center group focus:outline-none"
    >
      <div className="w-px my-2 rounded-full transition-colors group-hover:bg-[#d4af37]/60 group-active:bg-[#d4af37] group-focus-visible:bg-[#d4af37]" style={{ background: 'rgba(var(--fg-rgb),0.1)' }} />
    </div>
  );
}

/**
 * @param {object} left    { min, max, width, onWidthChange, content } — fixed-px pane
 * @param {object} center  { min, max, content } — fills remaining space, own bounds
 * @param {object} right   { min, max, width, onWidthChange, content, hidden } — fixed-px pane
 */
export default function ResizablePanes({ left, center, right, className = '' }) {
  const containerRef = useRef(null);
  const leftRef = useRef(null);
  const rightRef = useRef(null);
  const dragRef = useRef(null); // { side, startX, startLeft, startRight, containerWidth }

  const commit = useCallback((side, px) => {
    if (side === 'left') left.onWidthChange(px);
    else right.onWidthChange(px);
  }, [left, right]);

  const applyLive = useCallback((side, leftPx, rightPx) => {
    if (leftRef.current) leftRef.current.style.width = `${leftPx}px`;
    if (rightRef.current) rightRef.current.style.width = `${rightPx}px`;
  }, []);

  // Given a candidate width for the pane being dragged, keep the CENTER pane inside
  // its own [min,max] by borrowing/returning space to the OTHER outer pane first
  // (Issue 3/4: "Supplier View must not become excessively wide" — enforced here as a
  // shared constraint between both splitters, not a one-off check on one side).
  const resolve = useCallback((side, candidateLeft, candidateRight, containerWidth) => {
    const SPLITTER = 12; // two 12px splitter hit-areas (w-3 = 0.75rem = 12px)
    let l = clamp(candidateLeft, left.min, left.max);
    let r = clamp(candidateRight, right.min, right.max);
    const impliedCenter = containerWidth - SPLITTER * (right.hidden ? 1 : 2) - l - (right.hidden ? 0 : r);
    if (impliedCenter > center.max) {
      const excess = impliedCenter - center.max;
      if (side === 'left') {
        const rightRoom = right.hidden ? 0 : right.max - r;
        const giveRight = Math.min(excess, rightRoom);
        r += giveRight;
        l = clamp(l + (excess - giveRight), left.min, left.max);
      } else {
        const leftRoom = left.max - l;
        const giveLeft = Math.min(excess, leftRoom);
        l += giveLeft;
        r = clamp(r + (excess - giveLeft), right.min, right.max);
      }
    } else if (impliedCenter < center.min) {
      // Content area would be starved below its own usable floor — pull the excess
      // back from whichever pane isn't currently being dragged first.
      const deficit = center.min - impliedCenter;
      if (side === 'left') {
        const rightGive = Math.min(deficit, Math.max(0, r - right.min));
        r -= rightGive;
        l = clamp(l - (deficit - rightGive), left.min, left.max);
      } else {
        const leftGive = Math.min(deficit, Math.max(0, l - left.min));
        l -= leftGive;
        r = clamp(r - (deficit - leftGive), right.min, right.max);
      }
    }
    return { l, r };
  }, [left, right, center]);

  const beginDrag = useCallback((side) => (e, keyboardDelta) => {
    const containerWidth = containerRef.current?.getBoundingClientRect().width || 0;
    const startLeft = left.width;
    const startRight = right.width;

    if (keyboardDelta != null) {
      // Keyboard resize (accessibility) — one discrete step, no pointer capture needed.
      const candidateLeft = side === 'left' ? startLeft + keyboardDelta : startLeft;
      const candidateRight = side === 'right' ? startRight + keyboardDelta : startRight;
      const { l, r } = resolve(side, candidateLeft, candidateRight, containerWidth);
      applyLive(side, l, r);
      commit('left', l);
      if (!right.hidden) commit('right', r);
      return;
    }

    e.preventDefault();
    const startX = e.clientX;
    const captureEl = e.currentTarget;
    const { pointerId } = e;
    dragRef.current = { side, startX, startLeft, startRight, containerWidth };
    // Defensive: setPointerCapture can throw (InvalidPointerId) if the browser doesn't
    // recognize this pointerId as an active pointer — must never abort the rest of this
    // handler (the cursor/listener setup below) just because this optional enhancement
    // (keeping the drag tracking a fast pointer that leaves the splitter's own bounds)
    // failed. The drag still works correctly without it; it just loses that one nicety.
    try { captureEl.setPointerCapture?.(pointerId); } catch { /* not fatal */ }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = ev.clientX - d.startX;
      const candidateLeft = d.side === 'left' ? d.startLeft + dx : d.startLeft;
      const candidateRight = d.side === 'right' ? d.startRight - dx : d.startRight;
      const { l, r } = resolve(d.side, candidateLeft, candidateRight, d.containerWidth);
      applyLive(d.side, l, r);
      dragRef.current.lastLeft = l;
      dragRef.current.lastRight = r;
    };
    const onUp = () => {
      const d = dragRef.current;
      if (d) {
        commit('left', d.lastLeft ?? d.startLeft);
        if (!right.hidden) commit('right', d.lastRight ?? d.startRight);
      }
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Same defensive note as setPointerCapture above — release can throw if capture
      // was never actually established; must not skip the listener cleanup below.
      try { captureEl.releasePointerCapture?.(pointerId); } catch { /* not fatal */ }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [left, right, resolve, applyLive, commit]);

  // The pane width is a runtime px VALUE, not a static class — Tailwind's `xl:` prefix
  // can't express "auto below 1280px, exactly Npx at/above it" for an arbitrary
  // per-render number. Scoped styled-jsx (built into Next.js, no extra dependency)
  // does that with one real media query instead of a JS matchMedia listener; the
  // actual number is threaded through as a CSS custom property set inline, so the
  // pane content itself is rendered exactly ONCE (no hidden-duplicate xl:/non-xl: pair).
  return (
    <div
      ref={containerRef}
      className={`xl:flex xl:items-stretch resizable-panes ${className}`}
      style={{ '--left-w': `${left.width}px`, '--right-w': `${right.width}px`, '--center-max': `${center.max}px` }}
    >
      <div ref={leftRef} className="pane-left mb-4 xl:mb-0 min-w-0" data-pane="left">{left.content}</div>

      <Splitter onDragStart={beginDrag('left')} label="Resize Supplier Directory" />

      <div className="pane-center xl:flex-1 xl:min-w-0 mb-4 xl:mb-0" data-pane="center">{center.content}</div>

      {!right.hidden && <Splitter onDragStart={beginDrag('right')} label="Resize Purchase Order panel" />}

      {!right.hidden && (
        <div ref={rightRef} className="pane-right hidden xl:block" data-pane="right">{right.content}</div>
      )}

      <style jsx>{`
        @media (min-width: 1280px) {
          .pane-left { width: var(--left-w); flex-shrink: 0; }
          .pane-right { width: var(--right-w); flex-shrink: 0; }
          .pane-center { max-width: var(--center-max); }
        }
      `}</style>
    </div>
  );
}
