import React from 'react';
import { ratingFor } from '../../../services/analyticsService';

// Shared card primitives for the Inventory dashboard / analytics / reports views.
// Pure presentational wrappers — no state, no data access. Extracted verbatim from
// components/InventoryDashboard.js (Refactor Phase 1 — leaf UI extraction).

// Executive Analytics card shell.
export function ACard({ title, icon: Icon, right, children }) {
  return (
    <div className="rounded-2xl p-4 sm:p-5 backdrop-blur-sm" style={{ background: 'rgba(var(--fg-rgb),0.02)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">{Icon && <Icon size={15} className="text-[#d4af37]" />}{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

// DASH_CARD_MIN_H is only a BACKSTOP for the case stretch can't help with: every card in
// a row being short/empty at once (e.g. a quiet day with nothing in Low Stock, Recent
// Activity, OR Top Selling) — nothing tall to stretch against, so without a floor the
// whole row could still look thin. It never fights stretch; whichever is taller wins.
// `flex flex-col` lets DashEmpty (below) claim the remaining space with `flex-1` and
// center itself in it, instead of sitting orphaned at the card's top-left — and lets a
// SHORTER card's real content (fewer rows, not empty) stay naturally positioned at the
// top once its outer box is stretched taller, rather than being force-stretched itself.
export const DASH_CARD_MIN_H = 'min-h-[260px]';
export function OverviewCard({ children, className = '' }) {
  return (
    <div className={`rounded-2xl p-4 backdrop-blur-sm ${DASH_CARD_MIN_H} flex flex-col ${className}`} style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
      {children}
    </div>
  );
}
// Shared empty-state body for every Dashboard widget — centered in whatever space the
// card's DASH_CARD_MIN_H floor gives it (via the parent's flex flex-col + this being
// flex-1), rather than each widget hand-rolling its own top-left `<p>`. `hint` is
// optional: only pass one where it adds real explanation, not just to fill space.
export function DashEmpty({ icon: Icon, title, hint }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center gap-1.5 py-4">
      {Icon && <Icon size={20} className="text-white/15" />}
      <p className="text-sm text-white/45">{title}</p>
      {hint && <p className="text-[11px] text-white/45 max-w-[240px]">{hint}</p>}
    </div>
  );
}

export function ScoreCard({ title, icon: Icon, score, suffix = '%', factors, note }) {
  const r = ratingFor(score);
  // A null / non-finite score is the genuine empty state (e.g. a shop with no
  // inventory yet). Show a dash and a 0-width bar — never "null%" or a coloured
  // band for a number that was never measured.
  const hasScore = score != null && Number.isFinite(score);
  const barPct = hasScore ? score : 0;
  return (
    <OverviewCard>
      <h3 className="text-xs uppercase tracking-wider text-white/45 mb-2 flex items-center gap-2"><Icon size={14} className="text-[#d4af37]" /> {title}</h3>
      <div className="flex items-end gap-2">
        <span className="text-3xl font-bold leading-none" style={{ color: r.color }}>{hasScore ? score : '—'}{hasScore && <span className="text-lg">{suffix}</span>}</span>
        <span className="text-sm font-semibold mb-0.5" style={{ color: r.color }}>{r.label}</span>
      </div>
      <div className="h-2 rounded-full mt-2.5 overflow-hidden" style={{ background: 'rgba(var(--fg-rgb),0.08)' }}>
        <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${barPct}%`, background: `linear-gradient(90deg, ${r.color}, ${r.color}aa)` }} />
      </div>
      {note && <p className="text-[11px] text-white/45 mt-2">{note}</p>}
      {factors && (
        <div className="mt-3 space-y-1.5">
          {factors.map((f) => {
            const noData = f.pct == null;
            return (
              <div key={f.label} className="flex items-center gap-2">
                <span className="text-[11px] text-white/50 w-24 flex-shrink-0">{f.label}</span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(var(--fg-rgb),0.06)' }}>
                  {!noData && <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${f.pct}%`, background: f.pct >= 75 ? '#34d399' : f.pct >= 50 ? '#d4af37' : '#fb923c' }} />}
                </div>
                {/* A factor with no underlying data shows 'N/A', never a fabricated number. */}
                <span className="text-[10px] text-white/45 w-8 text-right" title={noData ? 'Not enough data to measure this yet' : undefined}>{noData ? 'N/A' : `${f.pct}%`}</span>
              </div>
            );
          })}
        </div>
      )}
    </OverviewCard>
  );
}

// Reports-view charts live INSIDE ReportsView as `RptBars` / `RptDonut`.
export function RptCard({ title, right, children, className = '' }) {
  return (
    <div className={`rounded-2xl p-4 ${className}`} style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
      <div className="flex items-center justify-between mb-3"><p className="text-xs font-bold uppercase tracking-wide text-white/55">{title}</p>{right}</div>
      {children}
    </div>
  );
}
