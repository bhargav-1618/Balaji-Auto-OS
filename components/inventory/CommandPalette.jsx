import { useState, useEffect, useMemo } from 'react';
import { Search, Package, Users, Filter, Car, User, Receipt, ClipboardList } from 'lucide-react';
import { useDeferredSearch, useSearchIndex, rankIndexed } from '../../lib/useSearch';
import { asArray, safeLower } from '../../lib/format';
import { asList, flattenVehicles } from '../../services/inventoryService';

// Refactor Phase 13 — CommandPalette (the global Ctrl+K search overlay) extracted
// verbatim from components/InventoryDashboard.js. Pure presentation + local search
// state: no Firestore, no navigation, no activeTab. The container owns the global
// Ctrl+K keydown listener (it toggles `cmdkOpen`) and every onPick* callback — the
// palette only requests an action, it never implements navigation policy.

// Phase 8.4 — Global command palette (Ctrl+K). Searches parts, suppliers,
// categories & vehicles from existing data; arrow keys + Enter to navigate.
function CommandPalette({ open, onClose, inventory, suppliers, customers = [], invoices = [], jobCards = [],
  onPickPart, onPickSupplier, onPickCategory, onPickVehicle, onPickCustomer, onPickInvoice, onPickJobCard }) {
  const [q, setQ] = useState('');
  const [dq] = useDeferredSearch(q); // Universal Search review: was rebuilt on every raw keystroke
  const [sel, setSel] = useState(0);
  useEffect(() => { if (open) { setQ(''); setSel(0); } }, [open]);

  const activeParts = useMemo(() => inventory.filter((p) => !p.archived), [inventory]);

  // GLOBAL SEARCH ACCURACY: unique identifiers (Part Number/SKU, Customer ID, Registration
  // No., Invoice No., Job Card No.) match exact-then-partial via rankIndexed (identifier
  // hits ranked above name/phone/vehicle/status matches). Universal Search review: each
  // record type's index is now built ONCE per data change (useSearchIndex), not rebuilt
  // from scratch on every keystroke inside the query-dependent memo below — and every
  // pushed result carries its own relevance score so the final 30-result cap keeps the
  // BEST matches across all types, instead of parts (pushed first) silently crowding out
  // a genuinely closer customer/invoice/job-card match once ≥30 parts happen to match.
  const partIndex = useSearchIndex(activeParts, (p) => p.id, (p) => [p.name], (p) => [p.sku]);
  const supplierIndex = useSearchIndex(suppliers, (s) => s.id, (s) => [s.name, ...asArray(s.altNames)], (s) => [s.code, s.gst]);
  const customerIndex = useSearchIndex(customers, (c) => c.id, (c) => [c.name, c.phone], (c) => [c.code, ...asArray(c.vehicles).flatMap((v) => [v.regNo, v.reg])]); // PH21-D1 — a wrong-type `vehicles` must not crash the command palette
  const invoiceIndex = useSearchIndex(invoices, (iv) => iv.id, (iv) => [iv.customer, iv.vehicle], (iv) => [iv.invNo, iv.regNo]);
  const jobCardIndex = useSearchIndex(jobCards, (j) => j.jobNo, (j) => [j.customer, j.vehicle, j.status], (j) => [j.jobNo, String(j.jobNo || '').replace(/\D/g, ''), j.regNo]);

  const results = useMemo(() => {
    const needle = dq.trim();
    const out = [];
    const push = (item, score) => { if (score > 0) out.push({ ...item, score }); };
    activeParts.forEach((p) => {
      push({ type: 'part', id: p.id, label: p.name, sub: `Part · ${p.sku || 'no SKU'} · ${p.stock ?? 0} in stock`, data: p },
        needle ? rankIndexed(partIndex.get(p.id), needle) : 1);
    });
    // Issue 8 (cross-module review) — this was the one record type in the palette that
    // didn't exact-match its own identifiers (code/GST), unlike parts/customers/invoices/
    // job cards just below, and unlike SupplierDirectory.jsx's own search over the same data.
    suppliers.forEach((s) => {
      push({ type: 'supplier', id: s.id, label: s.name, sub: 'Supplier', data: s },
        needle ? rankIndexed(supplierIndex.get(s.id), needle) : 1);
    });

    // Operational records. The palette previously searched only the CATALOGUE
    // (parts/suppliers/categories) — but the person on the phone is a customer quoting a
    // number plate or an invoice number, and the receptionist had nowhere to type it.
    // Only search these once something is typed, so the palette doesn't open showing
    // 1,000 customers.
    if (needle) {
      customers.forEach((c) => {
        const regs = asArray(c.vehicles).map((v) => v.regNo || v.reg).filter(Boolean); // PH21-D1
        push({ type: 'customer', id: c.id, label: c.name,
          sub: `Customer · ${[c.phone, regs.join(', ')].filter(Boolean).join(' · ')}`, data: c },
          rankIndexed(customerIndex.get(c.id), needle));
      });
      invoices.forEach((iv) => {
        push({ type: 'invoice', id: iv.id, label: iv.invNo || 'Invoice',
          sub: `Invoice · ${[iv.customer, iv.regNo].filter(Boolean).join(' · ')}`, data: iv },
          rankIndexed(invoiceIndex.get(iv.id), needle));
      });
      jobCards.forEach((j) => {
        push({ type: 'jobcard', id: j.jobNo, label: j.jobNo || 'Job card',
          sub: `Job card · ${[j.regNo, j.customer, j.status].filter(Boolean).join(' · ')}`, data: j },
          rankIndexed(jobCardIndex.get(j.jobNo), needle));
      });
    }
    const ql = needle.toLowerCase();
    const cats = new Set();
    activeParts.forEach((p) => asList(p.categories).concat(p.category || []).forEach((c) => { if (c) cats.add(c); }));
    [...cats].forEach((c) => {
      const score = !needle ? 1 : safeLower(c) === ql ? 3 : safeLower(c).startsWith(ql) ? 2 : safeLower(c).includes(ql) ? 1 : 0;
      push({ type: 'category', id: `c-${c}`, label: c, sub: 'Category', data: c }, score);
    });
    const vehs = new Set();
    activeParts.forEach((p) => flattenVehicles(p.compatibleCars).forEach((v) => { if (v) vehs.add(v); }));
    [...vehs].forEach((v) => {
      const score = !needle ? 1 : safeLower(v) === ql ? 3 : safeLower(v).startsWith(ql) ? 2 : safeLower(v).includes(ql) ? 1 : 0;
      push({ type: 'vehicle', id: `v-${v}`, label: v, sub: 'Vehicle', data: v }, score);
    });
    if (needle) out.sort((a, b) => b.score - a.score);
    return out.slice(0, 30);
  }, [dq, activeParts, suppliers, customers, invoices, jobCards, partIndex, supplierIndex, customerIndex, invoiceIndex, jobCardIndex]);

  const pick = (r) => {
    if (!r) return;
    if (r.type === 'part') onPickPart(r.data);
    else if (r.type === 'supplier') onPickSupplier(r.data);
    else if (r.type === 'category') onPickCategory(r.data);
    else if (r.type === 'vehicle') onPickVehicle(r.data);
    else if (r.type === 'customer') onPickCustomer?.(r.data);
    else if (r.type === 'invoice') onPickInvoice?.(r.data);
    else if (r.type === 'jobcard') onPickJobCard?.(r.data);
    onClose();
  };

  if (!open) return null;
  // Was missing entries for 'customer'/'invoice'/'jobcard' — those three result types
  // were added to `results` (see the useMemo above) without adding matching icons
  // here, so `icon[r.type]` resolved to undefined for them and <Ic .../> crashed the
  // whole app ("Element type is invalid... got: undefined") the moment a search
  // actually matched a customer, invoice, or job card.
  const icon = { part: Package, supplier: Users, category: Filter, vehicle: Car, customer: User, invoice: Receipt, jobcard: ClipboardList };
  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center pt-[12vh] px-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div className="w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl" style={{ background: 'var(--surface-2)', border: '1px solid rgba(212,175,55,0.3)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
          <Search size={16} className="text-white/45" />
          <input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); pick(results[sel]); }
              else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            }}
            placeholder="Search parts, suppliers, categories, vehicles…"
            className="flex-1 bg-transparent outline-none text-sm text-white placeholder-white/30"
          />
          <kbd className="text-[10px] text-white/45 border border-white/15 rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <p className="text-sm text-white/45 text-center py-8">No matches.</p>
          ) : results.map((r, i) => {
            // Fallback to Search rather than crash if a future result `type` is added
            // to the useMemo above without a matching entry in `icon` — exactly what
            // just happened for customer/invoice/jobcard.
            const Ic = icon[r.type] || Search;
            return (
              <button
                key={r.id}
                onMouseEnter={() => setSel(i)}
                onClick={() => pick(r)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left ${i === sel ? 'bg-[#d4af37]/12' : 'hover:bg-white/[0.04]'}`}
              >
                <Ic size={15} className={i === sel ? 'text-[#d4af37]' : 'text-white/45'} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-white truncate">{r.label}</span>
                  <span className="block text-[11px] text-white/45">{r.sub}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="px-4 py-2 border-t border-white/8 flex items-center gap-3 text-[10px] text-white/45">
          <span>↑↓ navigate</span><span>↵ open</span><span>esc close</span>
        </div>
      </div>

      <p className="text-center text-[11px] text-white/45 pt-1 pb-2">
        Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 border border-white/15 text-white/60 font-mono">Ctrl</kbd> + <kbd className="px-1.5 py-0.5 rounded bg-white/10 border border-white/15 text-white/60 font-mono">K</kbd> to search anything
      </p>
    </div>
  );
}

export default CommandPalette;
