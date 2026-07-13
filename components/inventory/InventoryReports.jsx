// components/inventory/InventoryReports.jsx
// PHASE 1 · Slice 3 — Reports page. Computed inventory reports: valuation by
// category, dead stock, low/out, and profit by category. Each report is a clean
// table with a CSV export. All computed live; no schema change.
import React, { useMemo, useState, useEffect } from 'react';
import Pagination from './Pagination';
import { FileText, Layers, Snowflake, AlertTriangle, TrendingUp, Download } from 'lucide-react';

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const catOf = (p) => (Array.isArray(p.categories) && p.categories[0]) || p.category || 'Uncategorised';

function downloadCSV(filename, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function InventoryReports({ inventory = [], sales = [], formatINR }) {
  const [report, setReport] = useState('valuation');
  const [page, setPage] = useState(1);
  const PER = 25;
  useEffect(() => { setPage(1); }, [report]);
  const inr = (n) => (typeof formatINR === 'function' ? formatINR(n) : `₹${Math.round(num(n)).toLocaleString('en-IN')}`);

  const built = useMemo(() => {
    const active = inventory.filter((p) => !p.archived);
    const soldByPart = {};
    sales.forEach((s) => { if (s.partId) soldByPart[s.partId] = (soldByPart[s.partId] || 0) + num(s.qty || s.quantity || 1); });

    // Valuation by category
    const catMap = {};
    active.forEach((p) => {
      const c = catOf(p);
      if (!catMap[c]) catMap[c] = { category: c, parts: 0, units: 0, value: 0, profit: 0 };
      const b = catMap[c];
      b.parts += 1;
      b.units += num(p.stock);
      b.value += num(p.stock) * num(p.sellingPrice);
      b.profit += num(p.stock) * (num(p.sellingPrice) - num(p.purchasePrice));
    });
    const valuation = Object.values(catMap).sort((a, b) => b.value - a.value);

    const deadStock = active
      .filter((p) => (soldByPart[p.id] || 0) === 0 && num(p.stock) > 0)
      .map((p) => ({ name: p.name, sku: p.sku || '', category: catOf(p), units: num(p.stock), locked: num(p.stock) * num(p.purchasePrice) }))
      .sort((a, b) => b.locked - a.locked);

    const lowOut = active
      .filter((p) => num(p.stock) <= num(p.minStock || 5))
      .map((p) => ({ name: p.name, sku: p.sku || '', category: catOf(p), stock: num(p.stock), min: num(p.minStock || 5), status: num(p.stock) === 0 ? 'Out of stock' : 'Low' }))
      .sort((a, b) => a.stock - b.stock);

    const profit = valuation.map((c) => ({ category: c.category, value: c.value, profit: c.profit, margin: c.value ? Math.round((c.profit / c.value) * 100) : 0 }));

    return { valuation, deadStock, lowOut, profit };
  }, [inventory, sales]);

  const reports = {
    valuation: {
      label: 'Inventory Valuation', icon: Layers,
      cols: ['Category', 'Parts', 'Units', 'Stock value', 'Potential profit'],
      rows: built.valuation.map((r) => [r.category, r.parts, r.units, inr(r.value), inr(r.profit)]),
      csv: [['Category', 'Parts', 'Units', 'Stock value', 'Potential profit'], ...built.valuation.map((r) => [r.category, r.parts, r.units, Math.round(r.value), Math.round(r.profit)])],
      empty: 'No active inventory to value.',
    },
    dead: {
      label: 'Dead Stock', icon: Snowflake,
      cols: ['Part', 'SKU', 'Category', 'Units', 'Capital locked'],
      rows: built.deadStock.map((r) => [r.name, r.sku, r.category, r.units, inr(r.locked)]),
      csv: [['Part', 'SKU', 'Category', 'Units', 'Capital locked'], ...built.deadStock.map((r) => [r.name, r.sku, r.category, r.units, Math.round(r.locked)])],
      empty: 'No dead stock — everything with stock has sold.',
    },
    lowout: {
      label: 'Low / Out of Stock', icon: AlertTriangle,
      cols: ['Part', 'SKU', 'Category', 'Stock', 'Min', 'Status'],
      rows: built.lowOut.map((r) => [r.name, r.sku, r.category, r.stock, r.min, r.status]),
      csv: [['Part', 'SKU', 'Category', 'Stock', 'Min', 'Status'], ...built.lowOut.map((r) => [r.name, r.sku, r.category, r.stock, r.min, r.status])],
      empty: 'Everything is well stocked.',
    },
    profit: {
      label: 'Profit by Category', icon: TrendingUp,
      cols: ['Category', 'Stock value', 'Potential profit', 'Margin'],
      rows: built.profit.map((r) => [r.category, inr(r.value), inr(r.profit), `${r.margin}%`]),
      csv: [['Category', 'Stock value', 'Potential profit', 'Margin %'], ...built.profit.map((r) => [r.category, Math.round(r.value), Math.round(r.profit), r.margin])],
      empty: 'No data for profit analysis.',
    },
  };

  const active = reports[report];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <FileText size={18} className="text-[#d4af37]" />
        <h2 className="text-base font-bold text-white">Inventory reports</h2>
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.entries(reports).map(([k, r]) => (
          <button key={k} onClick={() => setReport(k)} className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold transition ${report === k ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]' : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10'}`}>
            <r.icon size={14} /> {r.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl overflow-hidden backdrop-blur-sm" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>
          <h3 className="text-sm font-bold text-white/90 flex items-center gap-2"><active.icon size={15} className="text-[#d4af37]" /> {active.label}</h3>
          {active.rows.length > 0 && (
            <button onClick={() => downloadCSV(`${active.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`, active.csv)} className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 active:scale-95 transition">
              <Download size={13} /> Export CSV
            </button>
          )}
        </div>
        {active.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                  {active.cols.map((c) => <th key={c} className="px-4 py-2.5 text-[11px] uppercase tracking-wider text-white/40 font-semibold whitespace-nowrap">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {active.rows.slice((page - 1) * PER, page * PER).map((row, i) => (
                  <tr key={i} className="transition hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.04)' }}>
                    {row.map((cell, j) => <td key={j} className={`px-4 py-2.5 whitespace-nowrap ${j === 0 ? 'text-white/85 font-medium' : 'text-white/60'}`}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-xs text-white/35 py-10 text-center">{active.empty}</p>}
        {active.rows.length > 0 && (
          <div className="px-4 pb-3"><Pagination page={page} total={active.rows.length} perPage={PER} onPage={setPage} /></div>
        )}
      </div>
    </div>
  );
}
