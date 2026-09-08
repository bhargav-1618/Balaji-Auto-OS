import React, { useState, useRef, useEffect } from 'react';
import { Minus, Plus } from 'lucide-react';
import toast from '../../../lib/toast';

// ---------------------------------------------------------------------------
// Stock stepper: [-] [input] [+] — Requirement 2
// ---------------------------------------------------------------------------
export default function StockStepper({ part, onCommit, onSell, big, canChangeStock = true, onBlocked }) {
  const [value, setValue] = useState(String(part.stock ?? 0));
  const editingRef = useRef(false);
  const btn = big ? 'w-11 h-11' : 'w-7 h-7';
  const inp = big ? 'flex-1 text-base py-2.5' : 'w-14 text-sm py-1';
  const ic = big ? 16 : 13;

  useEffect(() => {
    if (!editingRef.current) setValue(String(part.stock ?? 0));
  }, [part.stock]);

  function clamp(n) {
    return Math.max(0, parseInt(n, 10) || 0);
  }

  // Settings QA fix: the demo "Change Stock" permission gated onCommit/onSell
  // themselves, but this stepper applies its own value OPTIMISTICALLY before
  // that ever runs — a blocked commit still left the input showing the
  // incremented number, with nothing re-syncing it back (the resync effect
  // above only fires when part.stock itself changes, which a blocked commit
  // never does). Checking here, before the optimistic setValue, is the only
  // place that avoids the stuck-wrong-number state.
  function step(delta) {
    if (!canChangeStock) { onBlocked?.(); return; }
    const next = clamp((parseInt(value, 10) || 0) + delta);
    setValue(String(next)); // optimistic, instant
    onCommit(part.id, next); // async Firestore sync in background
  }

  function commitTyped() {
    editingRef.current = false;
    const next = clamp(value);
    const current = part.stock ?? 0;
    if (next !== current && !canChangeStock) { onBlocked?.(); setValue(String(current)); return; }
    // FIX-01: typing a LOWER number must not silently reduce stock — that bypasses
    // the sale record, the price-floor check, and every analytics report. Reducing
    // stock has to go through the Sell button (Checkout). Manual edits restock only.
    if (next < current) {
      toast.error('To reduce stock, use the red Sell button — it records the sale. Typing a lower number is disabled.');
      setValue(String(current));
      return;
    }
    setValue(String(next));
    if (next !== current) onCommit(part.id, next);
  }

  return (
    <div className="flex items-center gap-1.5">
      {/* Issue 3 + Feature 5: deduction = SALE. At 0 stock it opens the
          alternative-part suggester instead of a dead error. */}
      <button
        onClick={() => onSell(part)}
        title="Sell / deduct stock"
        className={`${btn} rounded-lg flex items-center justify-center transition active:scale-90 bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20`}
      >
        <Minus size={ic} />
      </button>

      <input
        type="number"
        min="0"
        value={value}
        onFocus={() => (editingRef.current = true)}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commitTyped}
        onKeyDown={(e) => {
          if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className={`${inp} text-center font-semibold rounded-lg outline-none bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60 transition`}
        style={{ MozAppearance: 'textfield' }}
      />

      <button
        onClick={() => step(1)}
        title="Add stock (restock)"
        className={`${btn} rounded-lg flex items-center justify-center transition active:scale-90 bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20`}
      >
        <Plus size={ic} />
      </button>
    </div>
  );
}
