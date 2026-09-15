// components/inventory/Pagination.jsx
// Small shared pager so every module list paginates consistently and scales to
// thousands of rows. Renders nothing when a single page fits.
import React, { useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function Pagination({ page, total, perPage = 20, onPage }) {
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  // PHASE 16 — if the dataset shrank under an active later page (a live
  // delete / archive / restore / status-change out of the current filter, or
  // a concurrent client's change — none of which fires the caller's own
  // filter-reset effect), pull the caller's page back into range. The caller
  // re-renders with the corrected page and its own row `.slice()` self-heals.
  // `onPage` is a state setter at every call site (referentially stable), so
  // this converges in one pass and never thrashes.
  useEffect(() => {
    if (page > pageCount) onPage(pageCount);
  }, [page, pageCount, onPage]);
  if (pageCount <= 1) return null;
  const safe = Math.min(Math.max(1, page), pageCount);
  const from = (safe - 1) * perPage + 1;
  const to = Math.min(safe * perPage, total);
  const btn = 'h-8 w-8 rounded-lg flex items-center justify-center text-white/70 bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition';
  return (
    <div className="flex items-center justify-between gap-3 mt-3 pt-3" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}>
      <span className="text-[11px] text-white/45">{from}–{to} of {total}</span>
      <div className="flex items-center gap-1.5">
        <button type="button" disabled={safe <= 1} onClick={() => onPage(safe - 1)} className={btn} aria-label="Previous page"><ChevronLeft size={15} /></button>
        <span className="text-xs text-white/60 px-1 tabular-nums">{safe} / {pageCount}</span>
        <button type="button" disabled={safe >= pageCount} onClick={() => onPage(safe + 1)} className={btn} aria-label="Next page"><ChevronRight size={15} /></button>
      </div>
    </div>
  );
}
