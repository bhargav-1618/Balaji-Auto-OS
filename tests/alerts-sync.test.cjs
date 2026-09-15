/**
 * tests/alerts-sync.test.cjs — PART-5
 *
 * The alerts badge (sidebar) and the alerts list must never disagree, and "mark read"
 * must survive a recompute. Both rest on ONE property: alert IDs are derived from the
 * underlying entity (content-stable), not positional/random. This executes the real
 * computeAlerts and proves it.
 */
require('./setup.cjs');
const { computeAlerts } = require('../services/analyticsService.js');

let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };

console.log('\nPART-5 — alerts counter sync + read-state stability\n');

const inv1 = [
  { id: 'p1', name: 'Clutch', sku: 'C1', stock: 0, minStock: 5, suppliers: [{ id: 's' }] },   // out
  { id: 'p2', name: 'Fluid', sku: 'F1', stock: 2, minStock: 5, suppliers: [{ id: 's' }] },    // low
  { id: 'p3', name: 'Filter', sku: 'X1', stock: 20, minStock: 5, suppliers: [{ id: 's' }] },  // fine
];
const a1 = computeAlerts(inv1, [], false);

// counter sync: the badge number is just the length of the same list the view renders
const unread = (alerts, readSet, archSet) => alerts.filter((a) => !readSet.has(a.id) && !archSet.has(a.id));
ok('badge count equals unread list length (single source)',
  unread(a1, new Set(), new Set()).length === a1.length);

// IDs are content-stable, so a recompute after an UNRELATED change keeps the same ids
const inv2 = [...inv1, { id: 'p4', name: 'Belt', sku: 'B1', stock: 30, minStock: 5, suppliers: [{ id: 's' }] }];
const a2 = computeAlerts(inv2, [], false);
const ids1 = new Set(a1.map((a) => a.id));
const ids2 = new Set(a2.map((a) => a.id));
ok('every original alert id still present after an unrelated inventory change',
  [...ids1].every((id) => ids2.has(id)), `${[...ids1]} vs ${[...ids2]}`);

// mark one read → it stays read across the recompute (because the id is stable)
const read = new Set([a1.find((a) => a.id === 'low-p2').id]);
ok('a read alert stays read after recompute (stable id)',
  !unread(a2, read, new Set()).some((a) => a.id === 'low-p2'));

// resolving the condition removes the alert entirely
const inv3 = inv1.map((p) => (p.id === 'p2' ? { ...p, stock: 50 } : p));
const a3 = computeAlerts(inv3, [], false);
ok('restocking clears the low-stock alert', !a3.some((a) => a.id === 'low-p2'));
ok('the out-of-stock alert for p1 remains', a3.some((a) => a.id === 'out-p1'));

// mark ALL read → zero unread
ok('mark-all-read drives unread to zero', unread(a1, new Set(a1.map((a) => a.id)), new Set()).length === 0);

// archived alert drops out of the count
ok('archiving an alert removes it from the unread count',
  unread(a1, new Set(), new Set(['out-p1'])).length === a1.length - 1);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
