/**
 * tests/demo-audit-log-shape.test.cjs
 *
 * BUG-LIVE-006 regression. The demo audit seed fabricated entries as
 *   { action: 'Created part', detail: 'Demo activity', user: 'demo@guest' }
 * — a shape matching neither the real audit writers (writeAudit / pushAudit, which
 * store a machine-key `action`, an entity `name` and `performedByEmail`) nor what
 * AuditRow renders, so every row showed "Created part — unknown".
 *
 * This asserts the demo audit trail now uses the real schema so it renders with a
 * real part/supplier identity and a real user.
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');
const { getDemoData } = require('../lib/demoData.js');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

console.log('\nBUG-LIVE-006 — demo audit log identity\n');

const { auditLog, parts, suppliers } = getDemoData();
const partNames = new Set(parts.map((p) => p.name));
const supplierNames = new Set(suppliers.map((s) => s.name));

// The machine-key actions the real writeAudit/pushAudit emit and AuditRow's labelMap knows.
const KNOWN_ACTIONS = new Set([
  'stock_adjustment', 'price_change', 'create_part', 'update_part', 'sell_part',
  'quick_restock', 'archive_part', 'restore_part', 'create_supplier', 'update_supplier',
  'archive_supplier', 'restore_supplier', 'delete_part', 'delete_supplier', 'below_floor_sale',
]);

ok('there are audit entries', auditLog.length > 20);

ok('no entry uses the old human-string action ("Created part" etc.)',
  auditLog.every((e) => !/^(Created part|Updated stock|Recorded sale|Received stock|Edited supplier|Adjusted inventory)$/.test(e.action)),
  auditLog.find((e) => /^Created part$/.test(e.action)) ? 'found "Created part"' : '');

ok('every entry has a machine-key action AuditRow can label',
  auditLog.every((e) => KNOWN_ACTIONS.has(e.action)),
  JSON.stringify([...new Set(auditLog.map((e) => e.action))]));

ok('every entry carries a real user email (not the old "demo@guest" / missing)',
  auditLog.every((e) => e.performedByEmail === 'demo@balajiautoos.com') &&
  auditLog.every((e) => e.user === undefined),
  JSON.stringify(auditLog[0]));

// AuditRow renders `e.name || e.partId || e.supplierId || '—'`. Every entry must
// resolve to a real identity, never "—".
ok('every entry resolves to a real part or supplier identity (never "—")',
  auditLog.every((e) => {
    const name = e.name || '';
    return (partNames.has(name) && e.partId) || (supplierNames.has(name) && e.supplierId);
  }),
  JSON.stringify(auditLog.find((e) => !e.name) || auditLog[0]));

// stock_adjustment / price_change entries must carry the details AuditRow expands.
const adj = auditLog.filter((e) => e.action === 'stock_adjustment');
ok('stock_adjustment entries carry a reason + before/after',
  adj.length > 0 && adj.every((e) => e.details && e.details.reason && Number.isFinite(e.details.stockBefore) && Number.isFinite(e.details.stockAfter)),
  JSON.stringify(adj[0]));

const pc = auditLog.filter((e) => e.action === 'price_change');
ok('price_change entries carry a from → to detail',
  pc.length > 0 && pc.every((e) => e.details && Object.values(e.details).every((v) => Number.isFinite(v.from) && Number.isFinite(v.to))),
  JSON.stringify(pc[0]));

// AuditRow's labelMap and OverviewView's ACT_LABEL must both map every action used.
const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');
const used = [...new Set(auditLog.map((e) => e.action))];
ok('AuditRow labelMap covers create_part / sell_part / create_supplier',
  /create_part: 'Created part'/.test(dash) && /sell_part: 'Recorded sale'/.test(dash) && /create_supplier: 'Added supplier'/.test(dash));
ok('every demo action key appears in InventoryDashboard\'s label maps',
  used.every((a) => new RegExp(`${a}:`).test(dash)),
  used.filter((a) => !new RegExp(`${a}:`).test(dash)).join(', '));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
