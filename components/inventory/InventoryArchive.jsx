// components/inventory/InventoryArchive.jsx
// PHASE 1 · Slice 2 — Archive as its own page (not a filter). Lists archived parts
// with archive date + who archived them, and role-gated Restore / Permanent delete.
// Reuses existing data + handlers; no data-model change.
import React, { useMemo, useState, useEffect } from 'react';
import { Archive, Search, ArchiveRestore, Trash2, PackageX } from 'lucide-react';
import Pagination from './Pagination';
import PageHeader from '../common/PageHeader';
import { useSearchIndex, matchIndexed } from '../../lib/useSearch';

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const toMillis = (t) => {
  if (!t) return 0;
  if (typeof t === 'number') return t < 1e12 ? t * 1000 : t;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (t?.seconds) return t.seconds * 1000;
  const p = Date.parse(t);
  return Number.isNaN(p) ? 0 : p;
};
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const cleanActor = (a) => {
  if (!a) return 'unknown';
  const s = String(a);
  return s.includes('@') ? s.split('@')[0] : s;
};

export default function InventoryArchive({
  inventory = [], formatINR, onRestore, onDelete, onEditPart, canRestore = false, canDelete = false, restoringId = null,
}) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const PER = 20;
  useEffect(() => { setPage(1); }, [q]);
  // GLOBAL SEARCH ACCURACY: Part Number (sku) matches by EXACT value only. Name/category
  // stay partial-searchable, unchanged.
  const archSearchIndex = useSearchIndex(inventory, (p) => p.id, (p) => [p.name, p.category], (p) => [p.sku]);
  const archived = useMemo(() => {
    const list = inventory.filter((p) => p.archived);
    const filtered = q.trim()
      ? list.filter((p) => matchIndexed(archSearchIndex.get(p.id), q))
      : list;
    return filtered.sort((a, b) => toMillis(b.archivedAt) - toMillis(a.archivedAt));
  }, [inventory, q, archSearchIndex]);

  const inr = (n) => (typeof formatINR === 'function' ? formatINR(n) : `₹${Math.round(num(n)).toLocaleString('en-IN')}`);

  return (
    <PageHeader title="Archived Parts" icon={Archive} subtitle={`${archived.length} item${archived.length === 1 ? '' : 's'}`}>
      <div className="flex sm:justify-end mb-3">
        <div className="relative w-full sm:w-72">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search archived parts…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm outline-none bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-[#d4af37]/60 transition"
          />
        </div>
      </div>

      {archived.length === 0 ? (
        <div className="p-12 flex flex-col items-center gap-3 text-center rounded-2xl" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
          <PackageX size={30} className="text-white/20" />
          <p className="text-sm text-white/45">{q ? 'No archived parts match your search.' : 'Nothing archived. Parts you archive will appear here, restorable anytime.'}</p>
        </div>
      ) : (
        <>
        <div className="space-y-2">
          {archived.slice((page - 1) * PER, page * PER).map((p) => (
            <div key={p.id} className="rounded-xl p-3 flex flex-wrap items-center gap-x-4 gap-y-2 transition hover:bg-white/[0.04]" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
              <button onClick={() => onEditPart?.(p)} className="flex-1 min-w-[180px] text-left">
                <p className="text-sm font-semibold text-white/90 truncate">{p.name}</p>
                <p className="text-[11px] text-white/45">
                  {p.sku ? `${p.sku} · ` : ''}{(Array.isArray(p.categories) && p.categories[0]) || p.category || 'Uncategorised'}
                  {num(p.stock) > 0 ? ` · ${num(p.stock)} in stock (${inr(num(p.stock) * num(p.sellingPrice))})` : ''}
                </p>
              </button>
              <div className="text-[11px] text-white/45 leading-tight">
                <div>Archived {fmtDate(toMillis(p.archivedAt))}</div>
                <div className="text-white/45">by {cleanActor(p.archivedBy)}</div>
              </div>
              <div className="flex items-center gap-2">
                {canRestore && (
                  <button
                    onClick={() => onRestore?.(p)}
                    disabled={restoringId === p.id}
                    className="h-9 px-3 rounded-lg flex items-center gap-1.5 text-xs font-semibold bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20 active:scale-95 transition disabled:opacity-50 disabled:cursor-wait"
                  >
                    <ArchiveRestore size={13} /> {restoringId === p.id ? 'Restoring…' : 'Restore'}
                  </button>
                )}
                {canDelete && (
                  <button onClick={() => onDelete?.(p)} className="h-9 px-3 rounded-lg flex items-center gap-1.5 text-xs font-semibold bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20 active:scale-95 transition" title="Permanently delete">
                    <Trash2 size={13} /> Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <Pagination page={page} total={archived.length} perPage={PER} onPage={setPage} />
        </>
      )}
    </PageHeader>
  );
}
