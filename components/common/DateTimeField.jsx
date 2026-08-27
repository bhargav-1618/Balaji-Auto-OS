// components/common/DateTimeField.jsx
// Split date + 12-hour time field — the ONE production Date & Time component used
// throughout the app. Avoids the native datetime-local popup entirely (which can't be
// reliably closed programmatically) so quick-set shortcut buttons always work and
// never leave a picker hanging open. Value stays in "YYYY-MM-DDTHH:mm" form.
// Originally lived only inside JobCardModule.jsx (its only two consumers, Date & Time
// In / Promised Delivery); extracted here — alongside MiniSelect/DropdownPanel/
// SearchSelect, the app's other shared production components — so any future module
// that needs a combined date+time field reuses this instead of hand-rolling another.
import React, { useState } from 'react';

const defaultInputCls = 'w-full px-3 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/25 outline-none focus:border-[#d4af37]/60 transition';

export const toLocalInput = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

// Quick-set presets, keyed so callers pass a short key + their own label rather
// than duplicating the day-offset/hour math per field. `hour: null` means "keep
// the current time exactly" (only 'now' does this); every other preset sets a
// specific hour so the shortcut is predictable regardless of when it's clicked.
const SHORTCUT_PRESETS = {
  now: { days: 0, hour: null },
  start9: { days: 0, hour: 9 },
  today6: { days: 0, hour: 18 },
  tomorrow: { days: 1, hour: 18 },
  plus2: { days: 2, hour: 18 },
  plus7: { days: 7, hour: 18 },
};

export default function DateTimeField({ value, onChange, min, shortcuts = [], inputCls = defaultInputCls }) {
  const parse = (v) => {
    if (!v) return { date: '', h12: '', m: '', ap: 'AM' };
    const [d, t = ''] = v.split('T');
    const [H = '', M = ''] = t.split(':');
    const h = Number(H);
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return { date: d, h12: H === '' ? '' : String(h12), m: M, ap };
  };
  const build = ({ date, h12, m, ap }) => {
    if (!date) return '';
    let H = Number(h12 || 0);
    if (ap === 'PM' && H < 12) H += 12;
    if (ap === 'AM' && H === 12) H = 0;
    const hh = String(H).padStart(2, '0');
    const mm = String(m === '' ? 0 : Number(m)).padStart(2, '0');
    return `${date}T${hh}:${mm}`;
  };
  const cur = parse(value);
  // Root cause of "typing an Hour/Minute does nothing before a Date is picked": the
  // value string can't represent "time without a date" — build() returned '' the
  // instant `date` was empty, which silently discarded whatever h12/m/ap the user had
  // just typed, on every keystroke. `pending` holds those parts locally until a real
  // date exists, so they survive being typed in any order instead of vanishing.
  const [pending, setPending] = useState(null);
  const effective = pending && !cur.date ? { ...cur, ...pending } : cur;
  const patch = (p) => {
    const next = { ...effective, ...p };
    if (!next.date) { setPending((prev) => ({ ...(prev || {}), ...p })); return; }
    setPending(null);
    onChange(build(next));
  };

  const apply = (k) => {
    const preset = SHORTCUT_PRESETS[k];
    if (!preset) return;
    const d = new Date(Date.now() + preset.days * 86400000);
    if (preset.hour != null) d.setHours(preset.hour, 0, 0, 0);
    setPending(null);
    onChange(toLocalInput(d));
  };
  const minDate = min ? String(min).split('T')[0] : undefined;
  // AM/PM: Left/Right (or Up/Down) toggles between the two options while the
  // group has focus — matches how a native radio/segmented-control group behaves.
  const onApKeyDown = (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      patch({ ap: effective.ap === 'AM' ? 'PM' : 'AM' });
    }
  };
  return (
    <div>
      {/* Tightened control widths (date min-width 140→112px, hour/minute 56→44px,
          AM/PM buttons 52→36px min) so all four controls fit on one line at the
          widths this field actually gets in a 2-column grid, instead of the
          AM/PM group wrapping to its own row (adding a full extra row of height).
          flex-wrap stays as a fallback for genuinely narrow (mobile) widths. */}
      <div className="flex flex-wrap gap-1 items-stretch">
        <input type="date" value={effective.date} min={minDate} onChange={(e) => patch({ date: e.target.value })} className={`${inputCls} flex-1 min-w-[112px]`} style={{ colorScheme: 'dark' }} aria-label="Date" />
        {/* !w-11 (important): inputCls itself carries w-full, and Tailwind's utility
            stylesheet order puts w-full AFTER plain numeric width utilities like w-11 —
            so an un-prefixed `w-11` here LOSES that CSS tie-break and the input silently
            renders full row width (confirmed via computed getBoundingClientRect: 228px,
            not 44px), pushing hour/minute/AM-PM to wrap onto their own rows regardless
            of the width class chosen. The `!` forces this one to win. */}
        <input type="number" inputMode="numeric" min={1} max={12} placeholder="hh" value={effective.h12} onChange={(e) => { const n = e.target.value.replace(/\D/g, '').slice(0, 2); patch({ h12: n }); }} className={`${inputCls} !w-11 text-center px-1`} aria-label="Hour" />
        <span className="self-center text-white/45">:</span>
        <input type="number" inputMode="numeric" min={0} max={59} placeholder="mm" value={effective.m} onChange={(e) => { const n = e.target.value.replace(/\D/g, '').slice(0, 2); patch({ m: n }); }} className={`${inputCls} !w-11 text-center px-1`} aria-label="Minute" />
        {/* Filled idle background (not just a faint border) so this reads as an
            interactive control at a glance, not as decorative text; h-11 matches
            the inputs' own height (py-2.5 + text-sm) so it's a real, consistent
            tap target with or without flex-wrap kicking in. */}
        <div
          className="flex h-11 rounded-xl overflow-hidden border border-[#d4af37]/50 bg-white/5 flex-shrink-0"
          role="group" aria-label="AM or PM"
          onKeyDown={onApKeyDown}
        >
          {['AM', 'PM'].map((x, i) => (
            <button
              key={x}
              type="button"
              onClick={() => patch({ ap: x })}
              aria-pressed={effective.ap === x}
              className={`min-w-[36px] px-2 text-xs font-bold transition ${i === 0 ? 'border-r border-[#d4af37]/40' : ''} ${effective.ap === x ? 'bg-[#d4af37] text-black' : 'text-white/75 hover:bg-white/10 hover:text-white'}`}
            >
              {x}
            </button>
          ))}
        </div>
      </div>
      {shortcuts.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {shortcuts.map(([k, label]) => (
            <button key={k} type="button" onClick={() => apply(k)} className="px-2 py-0.5 rounded-md text-[10px] font-semibold text-white/55 bg-white/5 border border-white/10 hover:bg-white/10 transition">{label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
