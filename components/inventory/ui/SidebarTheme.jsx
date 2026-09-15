import React, { useState, useEffect } from 'react';
import { STORAGE } from '../../../constants';

// Theme control unit — the sidebar's Dark / Warm / Light preset switch.
// Reads and writes the per-browser UI preference at localStorage[STORAGE.PREFS]
// (NOT business data — this key is identical in demo and production, and is the
// same cross-tab-synced prefs blob every other preference uses). Extracted
// verbatim from components/InventoryDashboard.js (Refactor Phase 1).
export const THEME_STOPS = [
  { key: 'dark', label: 'Dark', pos: 0 },
  { key: 'warm', label: 'Warm', pos: 50 },
  { key: 'light', label: 'Light', pos: 100 },
];
export const themeFromPos = (p) => THEME_STOPS.reduce((b, s) => (Math.abs(s.pos - p) < Math.abs(b.pos - p) ? s : b), THEME_STOPS[0]).key;
export const posFromTheme = (k) => (THEME_STOPS.find((s) => s.key === k) || THEME_STOPS[0]).pos;
export function applyThemeGlobally(t) {
  try { const p = JSON.parse(localStorage.getItem(STORAGE.PREFS) || '{}'); p.theme = t; localStorage.setItem(STORAGE.PREFS, JSON.stringify(p)); window.dispatchEvent(new CustomEvent('maruti-prefs')); } catch {}
  document.documentElement.setAttribute('data-theme', t);
}

export default function SidebarTheme({ collapsed }) {
  const [theme, setTheme] = useState(() => { try { return JSON.parse(localStorage.getItem(STORAGE.PREFS) || '{}').theme || 'dark'; } catch { return 'dark'; } });
  const [pos, setPos] = useState(() => { try { return posFromTheme(JSON.parse(localStorage.getItem(STORAGE.PREFS) || '{}').theme || 'dark'); } catch { return 0; } });
  useEffect(() => {
    const sync = () => { try { const t = JSON.parse(localStorage.getItem(STORAGE.PREFS) || '{}').theme || 'dark'; setTheme(t); setPos(posFromTheme(t)); } catch {} };
    window.addEventListener('maruti-prefs', sync);
    return () => window.removeEventListener('maruti-prefs', sync);
  }, []);
  const pickPreset = (k) => { setTheme(k); setPos(posFromTheme(k)); applyThemeGlobally(k); };
  if (collapsed) return null;
  return (
    <div className="mx-2 mb-1 p-2.5 rounded-xl" style={{ background: 'rgba(var(--fg-rgb),0.02)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
      <span className="block text-[10px] uppercase tracking-wide text-white/45 px-0.5 mb-1.5">Theme</span>
      <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ background: 'rgba(var(--fg-rgb),0.04)' }}>
        {THEME_STOPS.map((s) => (
          <button key={s.key} type="button" onClick={() => pickPreset(s.key)} title={s.label} aria-pressed={theme === s.key}
            className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition active:scale-95 ${theme === s.key ? 'bg-gradient-to-r from-[#d4af37] to-[#aa801e] text-black shadow' : 'text-white/55 hover:text-white/90'}`}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
