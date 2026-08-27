import React, { useState, useRef, useEffect, useMemo, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, X } from 'lucide-react';
import { useAnchoredPosition, useOutsideClose, PANEL_Z, MAX_PANEL_H } from './DropdownPanel';
import { rankIndexed, normId } from '../../lib/useSearch';

/**
 * SearchSelect — the ONE searchable dropdown used everywhere in Billing.
 *
 * Every dropdown in this app used to be hand-rolled, which is why they all behaved
 * differently: the customer list had no keyboard nav, the job card list had no <input>
 * at all, the vehicle list had neither, none of them closed on an outside click, and
 * none had a clear button. This component replaces all of them so the behaviour is
 * identical everywhere and there is exactly one place to fix a bug.
 *
 * Guarantees:
 *  - The search input is ALWAYS rendered while open (it can never "disappear").
 *  - Clear (X) appears whenever there is text: clears it, restores the full list,
 *    keeps the dropdown OPEN and returns focus to the input.
 *  - Outside click (and Esc) closes, preserves the selection, and discards the
 *    temporary search text. No invisible overlay is left behind.
 *  - Keyboard: ArrowUp / ArrowDown / Enter / Esc / Tab. Enter selects on the FIRST
 *    press. Mouse selects on the FIRST click (onMouseDown preventDefault keeps focus,
 *    otherwise the input blurs and the click lands on nothing).
 *  - The list is NEVER truncated. Long lists are virtualised (only the visible rows
 *    are in the DOM), so 100+ job cards or 20+ vehicles scroll smoothly.
 *  - The highlight is kept in view with scrollIntoView({ block: 'nearest' }), which
 *    never jumps the list to the top.
 */

const ROW_H = 52;        // fixed row height — required for virtualisation maths
const OVERSCAN = 6;      // rows rendered above/below the viewport to avoid flicker
const VIRTUALISE_OVER = 60; // below this, render everything (simpler, no jank)

// Panel geometry and placement now live in DropdownPanel — ONE implementation shared
// by every dropdown in the app, so a positioning bug can only be fixed in one place.
const FOOTER_H = 26;     // the "n of m · ↑↓ to move" strip

export default function SearchSelect({
  value,                    // currently selected display text ('' when nothing chosen)
  options = [],             // full list — NEVER pre-truncate this
  onSelect,                 // (option) => void
  getKey = (o, i) => o.id ?? i,
  getLabel = (o) => o.label ?? '',
  getSub = () => '',        // second line (dimmer)
  searchText = (o) => `${o.label ?? ''}`, // partial/free-text haystack for filtering
  searchIds = () => [],     // Universal Search review: identifier fields (reg no., VIN,
                             // invoice/job/customer code, GST...) — matched via the SAME
                             // exact-then-partial ranking every other module's list search
                             // already uses (lib/useSearch.js's rankIndexed), instead of
                             // being dumped into `searchText`'s single free-text haystack
                             // where an identifier fragment could match an unrelated
                             // option purely by substring coincidence. Optional — omit for
                             // an option type with no meaningful identifier field.
  placeholder = 'Search…',
  emptyText = 'No matches.',
  noOptionsText = 'Nothing available.',
  disabled = false,
  inputClassName = '',
  allowClearSelection = false,
  onClearSelection,
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  // a11y: aria-controls on the input must point at the listbox's id — generated per
  // instance so multiple SearchSelects on one page never collide.
  const listboxId = useId();
  // Was the highlight last moved by the KEYBOARD? Only then may we scroll it into view.
  const navByKey = useRef(false);

  const boxRef = useRef(null);     // wrapper — used for outside-click detection
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const panelRef = useRef(null);   // the portalled panel — also needs outside-click immunity

  // ---- filtering: searches the WHOLE list, never a slice -------------------
  // ISSUE 4 — dropdown typing latency.
  // `shown` used to be memoized on [options, q, searchText]. But every caller passes
  // `searchText`/`searchIds` as INLINE ARROWS, so their identity changes on every parent
  // render — the memo never held, and the haystack for every option was rebuilt (array +
  // join + toLowerCase, per option) on every render of the parent, not just on every
  // keystroke. Hold the functions in refs and key the index on the OPTIONS, which is
  // what it actually depends on. Typing then filters+ranks over precomputed entries.
  const searchTextRef = useRef(searchText);
  searchTextRef.current = searchText;
  const searchIdsRef = useRef(searchIds);
  searchIdsRef.current = searchIds;

  // Universal Search review: each option gets a { hay, ids } entry — free text stays
  // partial/token-matched exactly as before, identifiers (searchIds) are matched via
  // rankIndexed (exact match ranks highest, a partial fragment still surfaces the
  // option but ranked below an exact hit) instead of being mixed into one flat
  // lowercased string. This is the SAME primitive every list-page search in the app
  // uses (lib/useSearch.js) — one search implementation, not a second one for modals.
  const entries = useMemo(
    () => options.map((o) => ({
      hay: String(searchTextRef.current(o) || '').toLowerCase(),
      ids: (searchIdsRef.current(o) || []).filter(Boolean).map(normId),
    })),
    [options],
  );

  const shown = useMemo(() => {
    const l = q.trim();
    if (!l) return options;
    const scored = options
      .map((o, i) => ({ o, score: rankIndexed(entries[i], l) }))
      .filter((x) => x.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.map((x) => x.o);
  }, [options, q, entries]);

  // Keep the highlight valid whenever the result set changes, and reset the scroll
  // position. Without the scrollTop reset, narrowing a long list (e.g. 120 job cards
  // down to 1) left the container scrolled hundreds of pixels down, so the only match
  // sat above the viewport and the list looked EMPTY — the "dropdown gets stuck" bug.
  useEffect(() => {
    setHi(0);
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [q, options.length]);

  // ---- outside click / focus loss -----------------------------------------
  // pointerdown (not click) so the dropdown closes before the click lands, and so it
  // works for touch as well as mouse.

  const close = useCallback(() => {
    setOpen(false);
    setQ('');            // discard temporary search text; selection is untouched
    setScrollTop(0);
  }, []);

  const openList = () => {
    if (disabled) return;
    // Now that openList is also the CLICK handler (Issue 5), clicking an already-open
    // field must not reset the query the user has just typed.
    if (open) return;
    setOpen(true);
    setQ('');
    setHi(0);
    setScrollTop(0);
  };

  const choose = (o) => {
    if (!o) return;
    onSelect?.(o);
    close();
  };

  // ---- keyboard ------------------------------------------------------------
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      navByKey.current = true;
      if (!open) { openList(); return; }
      setHi((i) => Math.min(i + 1, Math.max(0, shown.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      navByKey.current = true;
      setHi((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open) choose(shown[hi]);   // selects on the FIRST Enter
      else openList();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      close();                        // let focus move on naturally
    } else if (e.key === 'Home' && open) {
      e.preventDefault(); navByKey.current = true; setHi(0);
    } else if (e.key === 'End' && open) {
      e.preventDefault(); navByKey.current = true; setHi(Math.max(0, shown.length - 1));
    }
  };

  // ---- panel placement -----------------------------------------------------
  // Positioning is delegated to DropdownPanel's hooks: the panel is portalled to
  // <body> at position:fixed, anchored to this field. It used to be `absolute` inside
  // the wrapper, which sits inside Billing's <Section> (`rounded-xl overflow-hidden`),
  // so anything past the card's padding box was CLIPPED — a customer with five
  // vehicles only ever saw one. No z-index defeats an overflow clip; the node has to
  // leave the subtree. See components/common/DropdownPanel.jsx.
  const pos = useAnchoredPosition(boxRef, open, MAX_PANEL_H);
  useOutsideClose(boxRef, panelRef, open, close);

  // ---- virtualisation ------------------------------------------------------
  const virtual = shown.length > VIRTUALISE_OVER;
  // Available height for the ROWS = panel budget minus the footer strip.
  const listMaxH = Math.max(ROW_H * 2, (pos?.maxH ?? MAX_PANEL_H) - FOOTER_H);
  const viewH = Math.min(listMaxH, Math.max(ROW_H * 3, shown.length * ROW_H));
  const start = virtual ? Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN) : 0;
  const end = virtual
    ? Math.min(shown.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN)
    : shown.length;
  const slice = shown.slice(start, end);

  // Keep the highlighted row visible WITHOUT yanking the list to the top.
  useEffect(() => {
    if (!open || !listRef.current) return;
    if (virtual) {
      const top = hi * ROW_H;
      const el = listRef.current;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
    } else {
      const el = listRef.current.querySelector(`[data-idx="${hi}"]`);
      // ISSUE 6: only follow the highlight when the user drove it with the keyboard.
      // Doing this on hover scrolled the list under the pointer, the row shifted between
      // mousedown and mouseup, and the browser therefore never fired `click` — which is
      // exactly why "Enter selects but the mouse does nothing".
      if (el && navByKey.current) el.scrollIntoView({ block: 'nearest' });
    }
  }, [hi, open, virtual]);

  const showClear = open && q.length > 0;

  return (
    <div ref={boxRef} className="relative">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45 pointer-events-none z-10" />

      {/* The search input is ALWAYS present while open. When closed it shows the
          selected value, so the field never looks empty after a selection. */}
      <input
        ref={inputRef}
        value={open ? q : (value || '')}
        onChange={(e) => { setQ(e.target.value); if (!open) setOpen(true); }}
        // ISSUE 5: focus alone must NOT open the list. Tabbing through the form, or
        // the browser autofocusing the first field, used to pop the customer dropdown
        // open over the page. It opens on CLICK or on TYPING — never on focus.
        onClick={openList}
        onKeyDown={onKeyDown}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        placeholder={options.length ? placeholder : noOptionsText}
        className={`${inputClassName} pl-9 pr-16`}
      />

      {/* Clear (X): only while typing. Clears the text, restores the FULL list,
          keeps the dropdown open, and puts focus back in the box. */}
      {showClear && (
        <button
          type="button"
          aria-label="Clear search"
          onMouseDown={(e) => e.preventDefault()}   // don't blur the input
          onClick={() => { setQ(''); setHi(0); setScrollTop(0); setOpen(true); inputRef.current?.focus(); }}
          className="absolute right-8 top-1/2 -translate-y-1/2 p-1 rounded-md text-white/45 hover:text-white hover:bg-white/10"
        >
          <X size={13} />
        </button>
      )}

      {/* Clear the SELECTION (distinct from clearing the search text). Focus moves to
          the input afterward — without it, focus was left on this button, which then
          unmounts the instant the caller clears `value` (allowClearSelection && value
          becomes false), dropping focus to document.body instead of staying usable. */}
      {!open && allowClearSelection && value && (
        <button
          type="button"
          aria-label="Clear selection"
          onClick={() => { onClearSelection?.(); inputRef.current?.focus(); }}
          className="absolute right-8 top-1/2 -translate-y-1/2 p-1 rounded-md text-white/45 hover:text-white hover:bg-white/10"
        >
          <X size={13} />
        </button>
      )}

      <button
        type="button"
        tabIndex={-1}
        aria-label={open ? 'Close list' : 'Open list'}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? close() : (inputRef.current?.focus(), openList()))}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-white/45 hover:text-white/70"
      >
        <ChevronDown size={14} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          data-searchselect-panel=""
          className="rounded-xl shadow-2xl overflow-hidden"
          style={{
            position: 'fixed',   // inline, not a Tailwind class: this is load-bearing
            zIndex: PANEL_Z,
            left: pos.left,
            width: pos.width,
            ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
            maxHeight: pos.maxH,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--surface-1)',
            border: '1px solid rgba(212,175,55,0.25)',
          }}
        >
          {shown.length === 0 ? (
            <p className="px-3 py-3 text-xs text-white/45">
              {options.length === 0 ? noOptionsText : (q ? `${emptyText} — “${q}”` : emptyText)}
            </p>
          ) : (
            <div
              ref={listRef}
              id={listboxId}
              role="listbox"
              onScroll={virtual ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
              className="overflow-y-auto overscroll-contain dark-scroll"
              style={{ maxHeight: listMaxH, flex: '1 1 auto', WebkitOverflowScrolling: 'touch' }}
            >
              {/* Spacer div gives the scrollbar the full height of the real list, so
                  the thumb is correctly sized even though only ~12 rows exist in the DOM. */}
              <div style={{ height: virtual ? shown.length * ROW_H : undefined, position: 'relative' }}>
                {slice.map((o, si) => {
                  const i = start + si;
                  const active = i === hi;
                  const sub = getSub(o);
                  return (
                    <button
                      key={`${getKey(o, i)}__${i}`}
                      data-idx={i}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => { navByKey.current = false; setHi(i); }}
                      onMouseDown={(e) => e.preventDefault()}  // first click selects
                      onClick={() => choose(o)}
                      className={`w-full text-left px-3 flex flex-col justify-center ${active ? 'bg-white/10' : 'hover:bg-white/5'}`}
                      style={virtual
                        ? { position: 'absolute', top: i * ROW_H, left: 0, right: 0, height: ROW_H }
                        : { height: ROW_H }}
                    >
                      <span className="text-sm text-white/85 truncate">{getLabel(o)}</span>
                      {sub ? <span className="text-[10px] text-white/45 truncate">{sub}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {shown.length > 0 && (
            <p className="px-3 py-1.5 text-[10px] text-white/45 border-t border-white/5" style={{ flex: '0 0 auto' }}>
              {shown.length} of {options.length}
              {virtual ? ' · scroll for more' : ''} · ↑↓ to move · Enter to select · Esc to close
            </p>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
