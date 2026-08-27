// components/common/DetailsPanel.jsx
// The ONE production "docked side panel beside a table" framework — shows a single
// selected record's full details next to the list it was picked from (Customers,
// Vehicles). NOT a replacement for every "view a record's details" surface in the
// app: Job Cards' preview uses a slide-in drawer, Billing's is a full-screen editor,
// Inventory's parts open a modal, and Suppliers' detail IS the primary content column
// of a 3-pane layout — those are different interaction idioms serving different
// workflows, not copy-pasted duplicates of this one, so consolidating them into this
// shape would be a workflow redesign, not a framework fix. This component exists for
// the pattern that WAS duplicated: Vehicles' side panel was an independent, stale
// copy of Customers' panel — fixed 370px width (not responsive), a flat `xl:top-4`
// sticky offset with no awareness of the app's own sticky header (so on scroll it
// would tuck UNDER the header instead of below it), and no independent scroll
// container (long content scrolled the whole page instead of just the panel).
// Customers' panel had already been fixed for exactly this class of bug earlier — this
// component is that fix, extracted so both callers (and any future one) share it
// instead of drifting apart again.
//
// This only owns the FRAME: responsive width, header-aware sticky positioning,
// max-height matched to what's actually visible below the app header, the
// pinned-header/scrolling-body split, and the empty state. Each caller keeps its own
// content (profile fields, tabs, history, whatever the record needs) as children —
// business content and workflow stay exactly where they were.
//
// A second, previously-undiscovered bug caught while building this shared component:
// `position: sticky` on the inner card rendered correctly (computed style really did
// say "sticky") but never actually STUCK — scrolling the page just carried it away
// like a normal static element. Root cause: the outer column is one of two items in a
// `flex ... items-start` row shared with the (much taller) table column. `items-start`
// means flex items are NOT stretched to the row's height — each sizes to its own
// content, so this column's box was only ever as tall as the panel card itself. A
// sticky element can only "stick" for as much vertical room as its own containing
// block (here, this outer column) actually has beyond its own height — with zero
// slack, there was nowhere for it to detach and hold, so it just tracked the scroll
// 1:1 the entire time. Confirmed live: an `xl:self-stretch` probe (matching the row's
// full height instead of just the card's) fixed it immediately — stuck and held at
// the correct offset across every scroll position tested. `xl:self-stretch` overrides
// alignment for just this one flex item, so the row's OTHER item (the table column)
// keeps its own `items-start` sizing — nothing else about the layout changes; the
// visible card still only occupies its own natural height at the top of the (now
// tall, invisible) column box.
//
// A THIRD "bug" — chased across two more attempts before being disproven — started from
// a raw Y-coordinate rect comparison: Customers' sticky toolbar (KPI stats + search +
// filters, `sticky z-20`, right below the app header) spans roughly 165px–470px once
// stuck, which overlaps the panel's own small default stuck position (~181px) in the Y
// axis, reading like "the dashboard background is overlapping the customer details."
// Two fixes were built against that diagnosis in turn:
//   1. An optional `topOffset` prop (default '1rem', unchanged for callers without a
//      competing toolbar — Vehicles) so Customers could pass a CONSTANT baking in the
//      toolbar's full height. This fixed the (assumed) overlap but broke the at-rest
//      case: CSS sticky's `top` is an unconditional floor, so a constant taller than the
//      panel's natural row-top-aligned position clamps it down immediately at scroll 0,
//      before the toolbar has stuck to anything — Customers' panel rendered ~300px below
//      the table's top at rest instead of flush with it like Vehicles.
//   2. A scroll-listener in the caller toggling that offset between 0 and the toolbar's
//      full height once the toolbar was CURRENTLY stuck — fixed the at-rest case, but
//      the toolbar's own stick-threshold sits only ~24px of scroll below rest, so the
//      offset jumped from 0 to ~355px in a single scroll tick: the panel visibly
//      snapped/relocated the instant any scrolling began, reading as "the panel is
//      scrolling with the page" instead of staying fixed.
// Both fixes were solving a problem the toolbar and panel don't actually have: they are
// SIBLING COLUMNS in the same flex row (table column, then this panel), occupying
// completely different horizontal ranges — a raw rect's Y-overlap doesn't mean anything
// is actually painted on top of anything else. Verified with `document.elementFromPoint()`
// (paint-level ground truth) at the panel's own on-screen coordinates across the FULL
// scroll range, with zero extra offset applied: the panel itself is what's actually
// rendered there every time; the toolbar never paints into the panel's column. Customers
// now passes no `topOffset` at all — same shared default as Vehicles, which never needed
// any of this.
//
// A FIFTH bug: giving the table column `flex-1` (unbounded growth) while this panel had
// a fixed `width: clamp(...)` (flex-grow: 0) meant that once the page shell was widened
// for wide monitors (the split-layout width-budget fix), 100% of the extra room flowed
// to the table alone — the panel stayed pinned at its 420px ceiling no matter how wide
// the row got, so the table increasingly dwarfed it. Measured at 1920px: table 1152px vs
// panel capped at 420px, a ~2.7:1 ratio, with the table's KPI cards stretching to
// 374px each just to fill unused width — reading as "the dashboard looks oversized/
// heavy" even though nothing overlapped and no space was wasted. Fixed by giving BOTH
// columns a flex-grow ratio instead of one unbounded + one fixed: the table
// (`xl:flex-[2_1_0%]`, set at each caller) grows twice as fast as this panel
// (`xl:flex-[1_1_0%]` below), so extra row width is now shared roughly 2:1 instead of
// 100:0 — every pixel is still claimed (no dead space reappears), just proportioned
// instead of dumped entirely on one side. min/max keep both within sane bounds at the
// extremes: the panel never drops below its old 320px floor or grows past 480px (up
// from 420px — the modest increase is a direct, deliberate result of it now sharing in
// the extra width rather than being excluded from it).
import React from 'react';

export default function DetailsPanel({
  widthCls = "xl:flex-[1_1_0%] xl:min-w-[320px] xl:max-w-[480px] xl:self-stretch mt-4 xl:mt-0",
  cardStyle,
  // Baseline alignment (reopened) — '1rem' was never chosen for a principled reason;
  // per this file's own history above, it was just "the default, unchanged" while
  // two DIFFERENT bugs were chased and disproven. It was never checked against exact
  // pixel alignment with the sibling column's first row — only loosely, via
  // elementFromPoint() paint-overlap checks. Measured precisely: this row sits close
  // enough to <main>'s own top padding edge that position:sticky's `top` acts as a
  // hard floor even AT REST (not just once scrolled) — a nonzero default forces the
  // panel down by the difference between "natural row-top position" and "topOffset",
  // which is exactly why Customers' panel rendered 16px BELOW its own KPI row's top
  // (this default's 16px, with nothing to counteract it — Customers has zero content
  // preceding its Stat cards). The correct baseline is 0: a caller whose column DOES
  // have content above its first KPI row (Vehicles' "Compliance" header) measures
  // that content's real height and passes it explicitly — see VehiclesModule.jsx's
  // panelTopOffset. Every caller with nothing preceding its KPI row (Customers) needs
  // no override at all now; it gets true flush alignment for free from this default.
  topOffset = '0px',
  empty,
  emptyIcon: EmptyIcon,
  emptyTitle,
  emptyHint,
  // emptyBullets/emptyTip replace the old emptyAction (a "+ New X" button rendered
  // INSIDE the empty state) — see this component's own callers' history: both
  // Customers and Vehicles duplicated their page toolbar's create button here, so
  // the same "Add Vehicle"/"New Customer" action existed twice on screen with no
  // hierarchy between them. An empty detail panel is a contextual information
  // surface, not a second action hub — global creation belongs to the toolbar only.
  // emptyBullets: array of strings describing what selecting a record reveals (e.g.
  // ['Vehicles', 'Job Cards', 'Invoices']) — rendered as a plain list under emptyHint.
  // emptyTip: one short guidance line (e.g. "Click a row to view details · Use
  // checkboxes for bulk actions") — informational only, never an action control.
  emptyBullets,
  emptyTip,
  emptyPadding = 'py-16',
  header,
  bodyRef,
  onBodyScroll,
  children,
}) {
  return (
    <div className={widthCls}>
      {/* max-height stays a Tailwind xl:-prefixed class (not inline style): max-height
          applies to `position:static` elements too, unlike `top` (which position:static
          simply ignores) — an inline style here would wrongly height-cap the panel on
          mobile/tablet, where it's meant to grow naturally in-flow below the list. The
          class itself is a static string (required for Tailwind's JIT to compile it),
          but the VALUE it computes is dynamic per-caller: it reads --panel-extra-offset,
          a plain CSS custom property set alongside `top` below — the same
          static-class-referencing-a-runtime-variable trick already used for
          --app-header-h/--demo-banner-h. */}
      <div
        className="xl:sticky rounded-2xl p-4 flex flex-col xl:max-h-[calc(100vh_-_var(--demo-banner-h,0px)_-_var(--app-header-h,68px)_-_var(--panel-extra-offset,1rem)_-_1rem)]"
        style={{
          ...cardStyle,
          '--panel-extra-offset': topOffset,
          /* <main> is the scroll container and already starts below the banner+header,
             so the sticky offset is just the visual gap — adding the chrome height again
             would push the panel down by a header's worth of empty space. */
          top: 'var(--panel-extra-offset, 1rem)',
        }}
      >
        {empty ? (
          <div className={`${emptyPadding} text-center`}>
            {EmptyIcon && <EmptyIcon size={26} className="mx-auto text-white/20 mb-3" />}
            {emptyTitle && <p className="text-sm font-bold text-white/80">{emptyTitle}</p>}
            {emptyHint && <p className="text-xs text-white/45 mt-1 px-4">{emptyHint}</p>}
            {emptyBullets && emptyBullets.length > 0 && (
              <ul className="mt-3 text-xs text-white/50 text-left inline-block mx-auto space-y-1.5">
                {emptyBullets.map((b) => (
                  <li key={b} className="flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-white/30 flex-shrink-0" />{b}
                  </li>
                ))}
              </ul>
            )}
            {emptyTip && <p className="text-[10px] text-white/45 mt-4 px-4">{emptyTip}</p>}
          </div>
        ) : (
          <>
            {/* Pinned header — always visible while the body scrolls */}
            <div className="flex-shrink-0">{header}</div>
            {/* Scrollable body — independent of the page's own scroll, sized to what's
                actually visible below the app header (see max-height above).
                Batch 4D Defect 2 originally added `overscrollBehavior: contain` here to
                stop wheel/touch input from chaining into <main> once this pane hit its
                own top/bottom edge. Reopened: <main> (InventoryDashboard.js, id
                APP_SCROLL_ID) is this panel's ONLY scrollable ancestor — there is no
                separate "customer list" scroll container to leak into, so blocking the
                chain there didn't isolate the panel from a sibling, it just made <main>
                itself unreachable by wheel while the cursor sat over the panel: once
                this pane's own content ran out, scrolling did nothing at all until the
                user physically moved the cursor off the panel. `contain` removed —
                default scroll chaining now hands off cleanly to <main> exactly like it
                would for any other scrollable element on the page, once (and only once)
                this pane has no more of its own content left to scroll. Simply DROPPING
                the inline style wasn't enough — `.dark-scroll` (globals.css) sets
                `overscroll-behavior: contain` at the class level too, shared by many
                unrelated scroll regions across the app (dropdown lists, ledger panes,
                etc.) where containment is genuinely wanted and must stay untouched. The
                inline `auto` here is a deliberate, scoped override — inline style beats
                the class rule by CSS specificity — so only THIS pane's chaining behavior
                changes, not `.dark-scroll` globally. */}
            <div ref={bodyRef} onScroll={onBodyScroll} className="flex-1 xl:overflow-y-auto dark-scroll xl:-mr-2 xl:pr-2 min-h-0" style={{ overscrollBehavior: 'auto' }}>
              {children}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
