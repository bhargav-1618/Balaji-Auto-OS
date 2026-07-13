import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Search, ChevronDown, X } from 'lucide-react';

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

export default function SearchSelect({
  value,                    // currently selected display text ('' when nothing chosen)
  options = [],             // full list — NEVER pre-truncate this
  onSelect,                 // (option) => void
  getKey = (o, i) => o.id ?? i,
  getLabel = (o) => o.label ?? '',
  getSub = () => '',        // second line (dimmer)
  searchText = (o) => `${o.label ?? ''}`, // haystack for filtering
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

  const boxRef = useRef(null);     // wrapper — used for outside-click detection
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // ---- filtering: searches the WHOLE list, never a slice -------------------
  const shown = useMemo(() => {
    const l = q.trim().toLowerCase();
    if (!l) return options;
    // every space-separated term must match, so "altroz ap36" narrows properly
    const terms = l.split(/\s+/);
    return options.filter((o) => {
      const hay = String(searchText(o) || '').toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [options, q, searchText]);

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
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) close();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setQ('');            // discard temporary search text; selection is untouched
    setScrollTop(0);
  }, []);

  const openList = () => {
    if (disabled) return;
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
      if (!open) { openList(); return; }
      setHi((i) => Math.min(i + 1, Math.max(0, shown.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
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
      e.preventDefault(); setHi(0);
    } else if (e.key === 'End' && open) {
      e.preventDefault(); setHi(Math.max(0, shown.length - 1));
    }
  };

  // ---- virtualisation ------------------------------------------------------
  const virtual = shown.length > VIRTUALISE_OVER;
  const viewH = Math.min(320, Math.max(ROW_H * 3, shown.length * ROW_H));
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
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }, [hi, open, virtual]);

  const showClear = open && q.length > 0;

  return (
    <div ref={boxRef} className="relative">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none z-10" />

      {/* The search input is ALWAYS present while open. When closed it shows the
          selected value, so the field never looks empty after a selection. */}
      <input
        ref={inputRef}
        value={open ? q : (value || '')}
        onChange={(e) => { setQ(e.target.value); if (!open) setOpen(true); }}
        onFocus={openList}
        onKeyDown={onKeyDown}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
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
          className="absolute right-8 top-1/2 -translate-y-1/2 p-1 rounded-md text-white/40 hover:text-white hover:bg-white/10"
        >
          <X size={13} />
        </button>
      )}

      {/* Clear the SELECTION (distinct from clearing the search text). */}
      {!open && allowClearSelection && value && (
        <button
          type="button"
          aria-label="Clear selection"
          onClick={() => onClearSelection?.()}
          className="absolute right-8 top-1/2 -translate-y-1/2 p-1 rounded-md text-white/40 hover:text-white hover:bg-white/10"
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
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-white/35 hover:text-white/70"
      >
        <ChevronDown size={14} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full rounded-xl shadow-2xl overflow-hidden"
          style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}
        >
          {shown.length === 0 ? (
            <p className="px-3 py-3 text-xs text-white/40">
              {options.length === 0 ? noOptionsText : (q ? `${emptyText} — “${q}”` : emptyText)}
            </p>
          ) : (
            <div
              ref={listRef}
              role="listbox"
              onScroll={virtual ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
              className="overflow-y-auto overscroll-contain dark-scroll"
              style={{ maxHeight: 320, WebkitOverflowScrolling: 'touch' }}
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
                      key={getKey(o, i)}
                      data-idx={i}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setHi(i)}
                      onMouseDown={(e) => e.preventDefault()}  // first click selects
                      onClick={() => choose(o)}
                      className={`w-full text-left px-3 flex flex-col justify-center ${active ? 'bg-white/10' : 'hover:bg-white/5'}`}
                      style={virtual
                        ? { position: 'absolute', top: i * ROW_H, left: 0, right: 0, height: ROW_H }
                        : { height: ROW_H }}
                    >
                      <span className="text-sm text-white/85 truncate">{getLabel(o)}</span>
                      {sub ? <span className="text-[10px] text-white/40 truncate">{sub}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {shown.length > 0 && (
            <p className="px-3 py-1.5 text-[10px] text-white/30 border-t border-white/5">
              {shown.length} of {options.length}
              {virtual ? ' · scroll for more' : ''} · ↑↓ to move · Enter to select · Esc to close
            </p>
          )}
        </div>
      )}
    </div>
  );
}
