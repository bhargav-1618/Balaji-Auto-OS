// components/common/MiniSelect.jsx
// Searchable, portal-anchored single-select combobox — the ONE production dropdown
// implementation for compact "pick or type a new value" fields (Manufacturer, Model,
// Variant, and similar catalog-backed pickers). Originally lived only inside
// JobCardModule.jsx (used for its Manufacturer/Model fields); extracted here so other
// modules reuse the same fixed implementation instead of shipping another one — see the
// Customers module's Vehicle section, which used to run a separate, older
// datalist-based combo with the exact class of outside-click bug this already fixes.
import React, { useState, useMemo, useRef, useEffect, useId } from 'react';
import { ChevronDown, Search, Plus, X } from 'lucide-react';
import DropdownPanel from './DropdownPanel';

const defaultInputCls = 'w-full px-3 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/25 outline-none focus:border-[#d4af37]/60 transition';

// boundaryRef (Batch 4D Defect 4): forwarded straight to DropdownPanel — pass the
// modal's own root when this MiniSelect lives inside one, so its panel's available
// height is bounded by the modal instead of the full browser viewport. Optional and
// unused by every existing caller, which keeps today's (viewport-only) behaviour.
// `width` (Universal dropdown architecture review): optional fixed popup width, for
// triggers too narrow to also host a usable search box + option list (e.g. an 80px
// "GST %" column in a dense invoice line row). Omitted everywhere else — the popup
// still defaults to matching the trigger's own width, unchanged for every existing
// caller. Same direct pass-through pattern already established in ActionMenu.jsx.
// `groups` (Issue 7.5): optional alternative to `options` for reason-style pickers
// where a long flat list becomes hard to scan (e.g. stock-adjustment reasons). Shape:
// `{ [groupLabel]: string[] }`. When passed, `options` is ignored and derived by
// flattening the groups (preserving their order) — every existing caller that only
// passes `options` is completely unaffected. Search/keyboard nav operate on that same
// flattened, filtered list; group labels are rendered as non-interactive header rows
// inline in the option list, not as separate dropdown levels — so this stays a single
// scan-and-pick interaction rather than adding an extra click.
export default function MiniSelect({ value, placeholder, options, groups, onPick, onAdd, addLabel, disabled, inputCls = defaultInputCls, labels, emptyValue = '', boundaryRef, width }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const ref = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  // Defect #48/#50 — every dropdown in the app renders through this one component, so
  // it had a single, app-wide accessibility gap: no ARIA roles at all. A screen reader
  // announced the trigger as a plain unlabelled button and the option list as an
  // undifferentiated group of buttons — it couldn't say "collapsed listbox", couldn't
  // announce which option is current, and arrow-key movement was invisible to anything
  // but sighted mouse-adjacent users. useId() gives each instance stable, unique ids
  // (safe with multiple MiniSelects open across different modals) to wire the
  // combobox/listbox/option relationship the ARIA 1.2 pattern expects.
  const uid = useId();
  const listboxId = `${uid}-listbox`;
  const optionId = (i) => `${uid}-option-${i}`;
  // Guards Enter-to-pick against a duplicate keydown dispatch landing before the
  // panel-closing re-render commits (both dispatches would otherwise read the same
  // pre-close `open`/`hi` state and call onPick twice). A ref (not state) is required
  // since the check must be synchronous within the same event-handling pass, before
  // any re-render — state wouldn't be visible to a second dispatch in time.
  const pickedRef = useRef(false);
  useEffect(() => { if (open) pickedRef.current = false; }, [open]);
  // Options are plain strings used as both the value and the display text — fine for
  // catalog data (Manufacturer, Model, State…) where the two are the same. A `labels`
  // map is optional: pass it only when an option's raw value needs a friendlier label
  // (e.g. the sentinel 'All' in a filter should read "All Customer Types"). Omitted
  // everywhere else — every existing call site is unaffected.
  const labelOf = (o) => (labels && labels[o]) || o;
  const flatOptions = useMemo(() => (groups ? Object.values(groups).flat() : (options || [])), [groups, options]);
  // NOTE: closing on outside-click/Escape is owned by the portalled <DropdownPanel>
  // below (useOutsideClose in DropdownPanel.jsx), which correctly checks BOTH the
  // anchor and the portalled panel. A local `mousedown` + ref.contains() check would be
  // WRONG here: the panel is portalled into <body>, so it is NOT a descendant of `ref` —
  // every mousedown on an option button would fire setOpen(false) before the click could
  // register, which is exactly the "closes without applying" bug this component exists
  // to avoid. Never re-add a local mousedown/ref.contains() closer here.
  const shown = useMemo(() => {
    const l = q.trim().toLowerCase();
    return l ? flatOptions.filter((o) => labelOf(o).toLowerCase().includes(l) || o.toLowerCase().includes(l)) : flatOptions;
  }, [q, flatOptions, labels]);
  // Groups are rendered as inline, non-interactive header rows within the same
  // option list — `hi` still indexes the flat `shown` array (arrow-key nav doesn't
  // change), each button just carries `data-idx` so scroll-into-view can find it by
  // that index instead of assuming it's the Nth DOM child (headers break that).
  const shownGroups = useMemo(() => {
    if (!groups) return null;
    const shownSet = new Set(shown);
    const out = [];
    Object.entries(groups).forEach(([label, opts]) => {
      const rows = opts.filter((o) => shownSet.has(o)).map((o) => ({ o, i: shown.indexOf(o) }));
      if (rows.length) out.push({ label, rows });
    });
    return out;
  }, [groups, shown]);
  // Arrow-key navigation: reset the highlight whenever the search text or the open
  // state changes (a fresh open, or a filtered list, both start highlighting the top
  // row), and keep the highlighted row scrolled into view as it moves.
  useEffect(() => { setHi(0); }, [q, open]);
  useEffect(() => { const el = listRef.current?.querySelector(`[data-idx="${hi}"]`); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }, [hi]);
  const canAdd = onAdd && q.trim() && !flatOptions.some((o) => o.toLowerCase() === q.trim().toLowerCase());
  // One atomic reset: clears the value, discards any in-progress search text, closes
  // the panel if it happened to be open, and returns focus to the trigger — regardless
  // of whether the panel was open or closed when Clear was clicked. Previously this
  // only called onPick(''), leaving stale search text and an open panel behind when
  // Clear was clicked while the panel was open.
  // Resets to emptyValue (not a hardcoded ''): plain pickers have emptyValue='' so this
  // is unchanged, but filter dropdowns pass emptyValue="All" — onPick('') there set a
  // value ('') that matches neither 'All' nor any real option, silently zeroing every
  // filtered result until the page was reloaded.
  const handleClear = () => {
    onPick(emptyValue);
    setQ('');
    setOpen(false);
    setHi(0);
    triggerRef.current?.focus();
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (pickedRef.current) return;
      if (shown[hi]) { pickedRef.current = true; onPick(shown[hi]); setOpen(false); setQ(''); }
      else if (canAdd) { pickedRef.current = true; onAdd(q.trim()); onPick(q.trim()); setOpen(false); setQ(''); }
    }
  };
  return (
    <div className="relative" ref={ref}>
      {/* Clear used to be a <span role="button"> NESTED INSIDE this trigger <button> —
          invalid HTML (a <button> may not contain other interactive/focusable
          descendants). Browsers handle that inconsistently: the outer button's own
          click/keydown handling can race with or swallow the inner span's, which is
          exactly the reported "needs multiple clicks" / "focus lost" / "keyboard
          interaction inconsistent" behavior. Clear is now a real, separate <button>,
          a SIBLING of the trigger (not nested), absolutely positioned into the same
          visual spot — fully native, reliable click/keyboard/focus handling.

          Icon positions are FIXED, not conditional: the trigger's right padding
          (!pr-12) and the chevron's position are the SAME whether or not a value is
          selected — only reserving room for Clear when `value` was truthy (toggling
          the padding) made the chevron visibly jump left the instant a value was
          picked, and jump back right on clear. Reserving the room unconditionally
          means neither icon ever moves; Clear simply occupies (or doesn't occupy) a
          slot that was always there. */}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        className={`${inputCls} flex items-center text-left !pr-12 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span className={`truncate ${value ? 'text-white' : 'text-white/45'}`}>{value ? labelOf(value) : placeholder}</span>
      </button>
      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/45 pointer-events-none" />
      {/* emptyValue: for plain pickers (Manufacturer, Model, State…) "nothing selected"
          is '', so `value && ...` already hid Clear correctly. Filter dropdowns instead
          use a non-empty sentinel like 'All' for their default/unselected state (so the
          trigger can show a friendly "All Makes" label via `labels` instead of a gray
          placeholder) — `value && ...` alone can never tell that apart from a REAL
          selection, so Clear rendered even when the filter was doing nothing. Comparing
          against `emptyValue` (defaults to '', callers pass 'All' for sentinel-based
          filters) fixes that without touching the picker call sites at all. */}
      {value && value !== emptyValue && !disabled && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleClear(); }}
          // Explicit Enter/Space handling rather than relying solely on native <button>
          // activation semantics — live keyboard testing showed a focused clear button
          // did not reliably activate on Enter alone. Belt-and-braces: harmless if the
          // browser's own default activation also fires (handleClear is idempotent —
          // it's a full state reset, not a toggle), guarantees it if not.
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); handleClear(); } }}
          aria-label={`Clear ${placeholder || 'selection'}`}
          className="absolute right-7 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center text-white/45 hover:text-white hover:bg-white/10 transition"
        >
          <X size={11} />
        </button>
      )}
      {open && !disabled && (
        <DropdownPanel anchorRef={ref} open onClose={() => { setOpen(false); setQ(''); }} scroll={false} boundaryRef={boundaryRef} width={width}
          style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="relative p-2" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.07)', flex: '0 0 auto' }}>
            <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/45" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKey}
              placeholder="Search…"
              role="combobox"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={shown[hi] ? optionId(hi) : undefined}
              className="w-full pl-8 pr-2 py-2 rounded-lg text-sm bg-white/5 border border-white/10 text-white placeholder-white/25 outline-none"
            />
          </div>
          <div ref={listRef} id={listboxId} role="listbox" className="overflow-y-auto dark-scroll" style={{ flex: '1 1 auto' }}>
            {shownGroups ? (
              shownGroups.map((g) => (
                <React.Fragment key={g.label}>
                  <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-white/45 select-none" aria-hidden="true">{g.label}</div>
                  {g.rows.map(({ o, i }) => (
                    <button key={o} id={optionId(i)} data-idx={i} role="option" aria-selected={o === value} type="button" onMouseEnter={() => setHi(i)} onClick={() => { onPick(o); setOpen(false); setQ(''); }} className={`w-full text-left px-3 py-2 text-sm transition ${o === value ? 'bg-[#d4af37]/15 text-white' : i === hi ? 'bg-white/10 text-white' : 'text-white/75 hover:bg-white/5'}`}>{labelOf(o)}</button>
                  ))}
                </React.Fragment>
              ))
            ) : (
              shown.map((o, i) => (
                <button key={o} id={optionId(i)} data-idx={i} role="option" aria-selected={o === value} type="button" onMouseEnter={() => setHi(i)} onClick={() => { onPick(o); setOpen(false); setQ(''); }} className={`w-full text-left px-3 py-2 text-sm transition ${o === value ? 'bg-[#d4af37]/15 text-white' : i === hi ? 'bg-white/10 text-white' : 'text-white/75 hover:bg-white/5'}`}>{labelOf(o)}</button>
              ))
            )}
            {shown.length === 0 && !q.trim() && <p className="px-3 py-3 text-xs text-white/45">No options.</p>}
          </div>
          {canAdd && (
            <button type="button" onClick={() => { const name = q.trim(); onAdd(name); onPick(name); setOpen(false); setQ(''); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-bold text-[#d4af37] hover:bg-white/5" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.07)', flex: '0 0 auto' }}><Plus size={13} /> Add &ldquo;{q.trim()}&rdquo;</button>
          )}
          {onAdd && !q.trim() && (
            <div className="px-3 py-2 text-[10px] text-white/45" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.07)', flex: '0 0 auto' }}>Type a name above to add it</div>
          )}
        </DropdownPanel>
      )}
    </div>
  );
}
