import React, { useState } from 'react';
import { tsToDate, formatINR } from '../../../lib/format';

// Issue 10/13: a single audit entry — collapsed summary that expands to the
// full record (reason, qty, before→after, notes, user, timestamp).
export default function AuditRow({ e }) {
  const [open, setOpen] = useState(false);
  const labelMap = {
    delete_part: 'Deleted part', delete_supplier: 'Deleted supplier', price_change: 'Price change',
    below_floor_sale: 'Below-floor sale', stock_adjustment: 'Stock adjustment',
    archive_part: 'Archived part', restore_part: 'Restored part',
    // BUG-LIVE-006: the real audit writers (writeAudit / pushAudit) also emit these
    // machine keys — without a mapping they rendered as raw "create_part" etc.
    create_part: 'Created part', update_part: 'Updated part', sell_part: 'Recorded sale',
    quick_restock: 'Received stock', create_supplier: 'Added supplier', update_supplier: 'Updated supplier',
    archive_supplier: 'Archived supplier', restore_supplier: 'Restored supplier',
    po_create: 'Purchase order created', po_status: 'Purchase order updated',
    category_rename: 'Category renamed', category_delete: 'Category deleted',
  };
  const label = labelMap[e.action] || e.action;
  const color = e.action === 'price_change' ? '#d4af37'
    : e.action === 'below_floor_sale' ? '#fb923c'
    : e.action === 'stock_adjustment' ? '#f59e0b'
    : e.action === 'archive_part' || e.action === 'restore_part' ? '#9ca3af'
    : '#f87171';
  const d = tsToDate(e.createdAt);
  const det = e.details || {};
  const summary = e.action === 'price_change'
    ? Object.entries(det).map(([f, v]) => `${f}: ${formatINR(v.from)}→${formatINR(v.to)}`).join(', ')
    : e.action === 'below_floor_sale'
    ? `floor ${formatINR(det.floor)} → ${formatINR(det.actual)}${det.qty ? ` ×${det.qty}` : ''}`
    : e.action === 'stock_adjustment'
    ? (() => {
        const d = (det.stockAfter != null && det.stockBefore != null) ? (det.stockAfter - det.stockBefore) : (det.qty || 0);
        return `${det.reason || ''} ${d < 0 ? '−' : '+'}${Math.abs(d)}${det.stockBefore != null ? ` (${det.stockBefore}→${det.stockAfter})` : ''}`;
      })()
    : e.action === 'delete_supplier' && det.unlinkedParts != null
    ? `unlinked ${det.unlinkedParts} part(s)` : '';
  const rows = [];
  if (e.action === 'stock_adjustment') {
    const d = (det.stockAfter != null && det.stockBefore != null) ? (det.stockAfter - det.stockBefore) : (det.qty || 0);
    rows.push(['Reason', det.reason || '—'], ['Quantity', `${d < 0 ? '−' : '+'}${Math.abs(d)}`], ['Stock', det.stockBefore != null ? `${det.stockBefore} → ${det.stockAfter}` : '—'], ['Notes', det.notes || '—']);
  } else if (e.action === 'below_floor_sale') {
    rows.push(['Floor price', formatINR(det.floor)], ['Actual price', formatINR(det.actual)], ['Quantity', det.qty ?? '—'], ['Override', 'Yes']);
  } else if (e.action === 'price_change') {
    Object.entries(det).forEach(([f, v]) => rows.push([f, `${formatINR(v.from)} → ${formatINR(v.to)}`]));
  }
  rows.push(['User', e.performedByEmail || 'unknown'], ['When', d ? d.toLocaleString('en-IN') : '—']);

  return (
    <div className="rounded-lg" style={{ background: 'rgba(var(--fg-rgb),0.02)', border: '1px solid rgba(var(--fg-rgb),0.05)' }}>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-start gap-2 text-xs px-2.5 py-2 text-left">
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0" style={{ background: `${color}22`, color }}>{label}</span>
        <div className="min-w-0 flex-1">
          <div className="text-white truncate">{e.name || e.partId || e.supplierId || '—'}{summary && <span className="text-white/45"> · {summary}</span>}</div>
          <div className="text-white/45 text-[10px]">{e.performedByEmail || 'unknown'}{d ? ` · ${d.toLocaleString('en-IN')}` : ''}</div>
        </div>
        <span className={`text-white/45 transition-transform flex-shrink-0 ${open ? 'rotate-90' : ''}`}>▶</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 pt-0.5 border-t border-white/5">
          <table className="w-full text-[11px]">
            <tbody>
              {rows.map(([k, v], i) => (
                <tr key={i}>
                  <td className="py-0.5 pr-3 text-white/45 align-top whitespace-nowrap">{k}</td>
                  <td className="py-0.5 text-white/80 break-words">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
