// components/common/ActionMenu.jsx — UNIVERSAL ISSUE U3: the ONE overflow/context-menu
// item-list renderer for the whole app.
//
// Before this: three genuinely different implementations existed side by side.
//   Tier A (Vehicles/Customers/JobCards/SupplierDirectory) — all four already composed
//     DropdownPanel for positioning, but hand-rolled their own item-row markup each
//     time, drifting on width/trigger-size/icon-size/text-size between call sites, with
//     no keyboard nav and no disabled/reason support.
//   Tier B (Billing's RowActionsMenu) — a fully independent reimplementation with its
//     own Portal + its own flip/clamp positioning math (duplicating DropdownPanel), but
//     the richest feature set: keyboard arrow-nav, section dividers, disabled+reason
//     tooltips, and a single-open-at-a-time registry (scoped only to itself).
//   Tier C (InventoryDashboard's "Actions ▼") — hand-rolled, NOT portaled at all (a
//     plain `absolute` div inside <main>'s own stacking context — the exact clipping/
//     z-index trap this codebase has already portal-fixed for DropdownPanel itself and
//     for several modals; see CustomersModule.jsx's CustomerWizard for the same class of
//     bug), with a redundant backdrop div for outside-close on top of a real mousedown
//     listener.
//
// This component keeps DropdownPanel exactly as the app's one positioning/portal
// primitive (content-agnostic by design — shared with MiniSelect and other field-style
// dropdowns, so it must not be taught menu-specific opinions) and adds, ONCE, the part
// every menu needed but each reimplemented or omitted: item rows (icon, label, danger,
// disabled+reason), section dividers, keyboard arrow-nav + Enter-to-select (lifted from
// Billing's implementation, the most complete of the three), and a single-open-at-a-time
// guarantee that now spans EVERY ActionMenu instance on the page, not just menus within
// the same module — opening any menu anywhere closes any other menu that happens to be
// open, matching what a user expects from "one menu at a time" even though today's three
// implementations only ever enforced that within their own module.
//
// Disabled+reason rows use the app's own established amber advisory color (`#fbbf24` —
// see CustomersModule.jsx's `F` field `warn` styling) for the reason icon, replacing
// Billing's dim `text-white/45` icon — a deliberate, minor consistency fix, not a
// behavior change.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import DropdownPanel from './DropdownPanel';

// Universal Issue #2 (contextual action menu architecture review) — every call site used to
// hand-pick its own pixel `width` (Job Cards 176, Vehicles 192, Supplier Directory 208,
// Customers 224, Inventory header 240, Billing 252): pure guesswork with no relationship to
// actual content, and exactly the "different modules... inconsistent" symptom reported. This
// measures each item's real rendered width (canvas text metrics, same technique used for
// tooltip/label sizing — synchronous, no DOM mutation, no layout thrash) so the menu sizes
// itself to its own content instead of every caller re-guessing a magic number. `width` is
// kept as an explicit override (consistent with DropdownPanel's own `boundaryRef` precedent:
// an explicit prop always wins) but no current call site needs to pass it any more.
const ROW_PAD_X = 24;      // px-3 both sides
const ICON_SLOT = 23;      // icon (13px) + gap-2.5 (10px)
const REASON_SLOT = 21;    // AlertTriangle (11px) + gap-2.5 (10px)
const SAFETY = 8;          // rounding/font-metric slack so text is never a hair too tight
const AUTO_MIN = 160;
const AUTO_MAX = 340;
const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

let measureCanvas = null;
function textWidth(text, font) {
  if (typeof document === 'undefined' || !text) return 0;
  measureCanvas = measureCanvas || document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  ctx.font = font;
  return ctx.measureText(text).width;
}

function computeAutoWidth(flat) {
  let max = 0;
  for (const it of flat) {
    if (it.type === 'section') {
      // uppercase + tracking-wider (0.05em ≈ 0.45px/char at 9px) — canvas metrics don't
      // account for letter-spacing, so approximate it explicitly rather than under-measure.
      const label = (it.label || '').toUpperCase();
      const w = ROW_PAD_X + textWidth(label, '700 9px ' + FONT_STACK) + label.length * 0.5;
      if (w > max) max = w;
    } else {
      const w = ROW_PAD_X + (it.icon ? ICON_SLOT : 0) + (it.disabled && it.reason ? REASON_SLOT : 0)
        + textWidth(it.label || '', '400 12px ' + FONT_STACK);
      if (w > max) max = w;
    }
  }
  return Math.max(AUTO_MIN, Math.min(AUTO_MAX, Math.ceil(max + SAFETY)));
}

// Module-scope, shared by every ActionMenu instance app-wide — not per-caller, so
// opening a menu in one module (e.g. a Vehicles row) correctly closes a menu left open
// in another (e.g. the header Actions menu). Keyed by a stable per-instance token
// (not by the caller's onClose reference, which is commonly a fresh arrow function on
// every render and therefore unsafe to use as an identity key) so the registry works
// correctly regardless of how the caller memoizes (or doesn't memoize) its onClose.
let activeToken = null;
let activeCloseFn = null;

/**
 * items: array of
 *   { type: 'item', key?, label, icon?, onClick, danger?, disabled?, reason? }
 *   { type: 'section', key?, label }
 * Falsy entries (from a caller's `cond && {...}` idiom) are filtered internally.
 */
export default function ActionMenu({
  anchorRef,
  open,
  onClose,
  items,
  // Explicit override — an escape hatch, not the normal path (see the computeAutoWidth
  // comment above). Every current call site omits this and gets a content-fitted width.
  width,
  // Passed straight through to DropdownPanel — for a future menu anchored inside a
  // modal, so its available room clamps to the modal's own container instead of the
  // full window (the same real need DropdownPanel's own boundaryRef exists for; see
  // that file's header comment). No current call site needs it, kept only because
  // it's a direct pass-through of the underlying primitive's own necessary API, not a
  // new speculative feature. Deliberately NOT exposing className/style overrides —
  // this component exists to give every menu ONE visual language, and a per-caller
  // styling escape hatch would just reopen the exact drift this consolidation removed.
  boundaryRef,
  panelRef: externalPanelRef,
}) {
  const localPanelRef = useRef(null);
  const panelRef = externalPanelRef || localPanelRef;
  const tokenRef = useRef({});
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const flat = (items || []).filter(Boolean);
  const navIdx = flat.map((it, i) => (it.type !== 'section' && !it.disabled ? i : -1)).filter((i) => i >= 0);
  const [hi, setHi] = useState(-1);
  const resolvedWidth = useMemo(() => width ?? computeAutoWidth(flat), [width, flat]);

  // Single-open-at-a-time, app-wide (see the module-scope registry comment above).
  // `token` is captured into the effect's own closure (not read from the ref at
  // cleanup time) since `tokenRef.current` is a stable object identity created once
  // per component instance — this just satisfies the exhaustive-deps rule cleanly.
  useEffect(() => {
    if (!open) return undefined;
    const token = tokenRef.current;
    if (activeToken && activeToken !== token && activeCloseFn) activeCloseFn();
    activeToken = token;
    activeCloseFn = () => closeRef.current?.();
    setHi(navIdx[0] ?? -1);
    return () => { if (activeToken === token) { activeToken = null; activeCloseFn = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keyboard nav — Escape is already owned by DropdownPanel itself; Arrow/Home/End/
  // Enter/Space are this component's responsibility. Capture phase (matching DropdownPanel's own
  // Escape listener): the keyboard-highlighted item receives real DOM focus (see the
  // effect below), so a bubble-phase listener here would depend on the event actually
  // bubbling cleanly from that focused, portaled element all the way to `document`
  // through both the native DOM tree and React's own synthetic event routing for
  // portals — verified live that a bubble-phase listener silently never fired here,
  // while capture phase (top-down, before anything else can intercept it) works
  // reliably regardless of what currently has focus.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => { const p = navIdx.indexOf(h); return navIdx[Math.min(p + 1, navIdx.length - 1)] ?? h; }); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => { const p = navIdx.indexOf(h); return navIdx[Math.max(p - 1, 0)] ?? h; }); }
      else if (e.key === 'Home') { e.preventDefault(); setHi(navIdx[0] ?? -1); }
      else if (e.key === 'End') { e.preventDefault(); setHi(navIdx[navIdx.length - 1] ?? -1); }
      else if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        const it = flat[hi];
        if (it && it.type !== 'section' && !it.disabled) { e.preventDefault(); onClose?.(); it.onClick(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hi, flat]);

  // Move DOM focus to the highlighted item so keyboard nav is visible and Tab flows
  // naturally out of the menu (no focus trap) — same approach as Billing's original.
  useEffect(() => {
    if (open && panelRef.current && hi >= 0) panelRef.current.querySelector(`[data-idx="${hi}"]`)?.focus?.();
  }, [open, hi, panelRef]);

  if (!open) return null;

  return (
    // closeOnScroll: a contextual menu (every ActionMenu instance is a three-dot
    // row/record menu) must never keep floating once the page has scrolled at
    // all — see DropdownPanel's own header comment for why this differs from
    // field-style dropdowns, which don't set it.
    <DropdownPanel anchorRef={anchorRef} open={open} onClose={onClose} width={resolvedWidth} panelRef={panelRef} boundaryRef={boundaryRef} closeOnScroll
      className="p-1" style={{ background: 'var(--surface-1)', border: '1px solid rgba(var(--fg-rgb),0.12)' }}>
      <div role="menu" onClick={(e) => e.stopPropagation()}>
        {flat.map((it, i) => {
          if (it.type === 'section') {
            return <div key={it.key || `s${i}`} role="separator" className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase tracking-wider text-white/45 select-none">{it.label}</div>;
          }
          const Icon = it.icon;
          return (
            <button
              key={it.key || it.label}
              data-idx={i}
              role="menuitem"
              tabIndex={-1}
              aria-disabled={it.disabled ? true : undefined}
              title={it.disabled ? (it.reason || 'Unavailable') : undefined}
              onMouseEnter={() => { if (!it.disabled) setHi(i); }}
              onClick={() => { if (it.disabled) return; onClose?.(); it.onClick(); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition focus:outline-none ${
                it.disabled ? 'text-white/45 cursor-not-allowed' : i === hi ? (it.danger ? 'bg-red-500/15 text-red-300' : 'bg-white/10 text-white') : (it.danger ? 'text-red-400 hover:bg-red-500/10' : 'text-white/75 hover:bg-white/5')
              }`}
            >
              {Icon && <Icon size={13} className="flex-shrink-0" />}
              <span className="flex-1 text-left">{it.label}</span>
              {it.disabled && it.reason ? <AlertTriangle size={11} className="text-[#fbbf24] flex-shrink-0" /> : null}
            </button>
          );
        })}
      </div>
    </DropdownPanel>
  );
}
