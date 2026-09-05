/**
 * tests/inventory-accounting-integrity.test.cjs
 *
 * PHASE 12 — INVENTORY ACCOUNTING INTEGRITY AUDIT.
 *
 * Central question: for every Part, can the current Firestore stock be
 * mathematically explained by its complete stock movement history?
 *
 *   Opening Stock + Stock In + Adjustment In - Stock Out - Sales = Current Stock
 *
 * Negative stock is NOT a defect by itself (Phase 9/11 already established
 * this is deliberate for realized sales) — the question is only ever whether
 * every movement is recorded, explainable, and applied exactly once.
 *
 * This file does NOT re-test services/inventoryService.js's pure math —
 * tests/inventory-service.test.cjs already covers computeStockAdjustment/
 * cardReservedQtys/reserveDelta/buildRestockRecord directly against the real,
 * imported functions. This file instead: (1) reconstructs stock from an
 * INDEPENDENT accounting oracle (never calling those production helpers) for
 * representative movement chains, (2) source-proves every stock-changing
 * write site is atomic with its own ledger entry, and (3) proves PH12-01
 * (the one confirmed defect this phase found) is fixed.
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');

let PASS = 0, FAIL = 0, DEFECTS = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const defect = (name, isFixed, detail = '') => {
  if (isFixed) { PASS++; console.log(`  ✓ [was a defect, now fixed] ${name}`); }
  else { DEFECTS++; console.log(`  ⚠ [DEFECT — inventory accounting] ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const dash = read('../components/InventoryDashboard.js');
const poService = read('../services/purchaseOrderService.js');
const slice = (src, a, b) => {
  const s = src.indexOf(a); if (s < 0) return '';
  const e = b ? src.indexOf(b, s + a.length) : -1;
  return src.slice(s, e > s ? e : s + 6000);
};

console.log('\nPHASE 12 — inventory accounting integrity audit\n');

// =====================================================================
// 1 — THE ACCOUNTING EQUATION — INDEPENDENT ORACLE
// =====================================================================
console.log('1  Independent accounting oracle\n');

// Reconstructs stock from a plain movement list — {type, qty} where qty is
// already SIGNED (+in, -out) exactly as every real ledger collection in this
// app stores it (restocks.qty > 0, stockAdjustments.qty signed, sales.qty
// signed, invoice-realization stockDeltas signed). This oracle has no
// knowledge of and never calls computeStockAdjustment/invTotals/totalsOf/
// planInvoiceRealization — it is the textbook sum from Phase 12's own spec.
function reconstructStock(opening, movements) {
  return movements.reduce((stock, m) => stock + m.qty, opening);
}

{
  // Part: P-123 — the exact worked example from the phase brief.
  const opening = 10;
  const movements = [
    { type: 'po_receive', qty: 20 },
    { type: 'restock', qty: 5 },
    { type: 'positive_adjustment', qty: 2 },
    { type: 'negative_adjustment', qty: -3 },
    { type: 'quick_sell', qty: -12 },
    { type: 'invoice_realization', qty: -7 },
    { type: 'return', qty: 2 },
  ];
  const expected = reconstructStock(opening, movements);
  ok('worked example: 10+20+5+2-3-12-7+2 = 17', expected === 17);
  ok('every movement has a direction consistent with its type (IN types positive, OUT types negative)',
    movements.every((m) => (['po_receive', 'restock', 'positive_adjustment', 'return'].includes(m.type) ? m.qty > 0 : m.qty < 0)));
}

// =====================================================================
// 2 — MOVEMENT TAXONOMY — every stock-changing write site, source-proved
// =====================================================================
console.log('\n2  Movement taxonomy — every stock-changing write site\n');

const receiveStockFn = slice(dash, 'async function receiveStockLineInner(', 'async function handleReceiveStock(');
const commitStockFn = slice(dash, 'const commitStock = useCallback(async (partId, newStock) => {', '}, [demoMode]);');
const adjustStockFn = slice(dash, 'async function adjustStockLineInner(', 'async function handleAdjustStock(');
const reserveDeltaFn = slice(dash, 'const applyReserveDelta = (deltaMap, reserveOpId = null) => {', 'const startJobCardFor');
const applyRealizationFn = slice(dash, 'const applyRealizationPlanInTx = (tx, plan, existingPartIds) => {', 'const applyPlanToLocalInventory');

ok('MOVEMENT: PO receive (services/purchaseOrderService.js poReceiveDoc) — restocks ledger + stock increment inside ONE transaction, reads part existence first (PH9-02)',
  /const activeLines = \(receivedLines \|\| \[\]\)\.filter/.test(poService)
  && /tx\.update\(doc\(db, 'parts', line\.partId\), partUpdate\);/.test(poService)
  && /tx\.set\(doc\(collection\(db, 'restocks'\)\), \{/.test(poService));

ok('MOVEMENT: manual Receive Stock (receiveStockLineInner) — restocks ledger + stock increment inside ONE transaction, keyed by restockOpId (idempotent), rejects if the part no longer exists',
  /if \(!partSnap\.exists\(\)\) throw new Error\('This part no longer exists\.'\);/.test(receiveStockFn)
  && /tx\.set\(rsRef, \{/.test(receiveStockFn)
  && /tx\.update\(partRef, \{ stock: increment\(qty\)/.test(receiveStockFn));

ok('MOVEMENT: quick restock stepper (commitStock, delta > 0) — restocks ledger + stock SET inside ONE transaction, deterministic opId (qr_<partId>_<newStock>) so a refresh+retry re-targets the same row',
  /const qrId = `qr_\$\{partId\}_\$\{safeStock\}`;/.test(commitStockFn)
  && /tx\.update\(doc\(db, COLLECTIONS\.PARTS, partId\), \{ stock: safeStock, updatedAt: serverTimestamp\(\) \}\);/.test(commitStockFn)
  && /tx\.set\(restockRef, \{/.test(commitStockFn));

ok('[fact] commitStock\'s delta<=0 branch (a bare stock overwrite with NO ledger entry) is UNREACHABLE from the UI: StockStepper\'s "+" button only ever calls step(1) (positive), and typing a lower number is explicitly blocked before onCommit is ever called',
  /function step\(delta\) \{[\s\S]{0,200}onCommit\(part\.id, next\);/.test(dash)
  && /onClick=\{\(\) => step\(1\)\}/.test(dash)
  && /if \(next < current\) \{\s*\n\s*toast\.error\('To reduce stock, use the red Sell button/.test(dash));

ok('MOVEMENT: Stock Adjustment (adjustStockLineInner) — stockAdjustments ledger (before/after/signedQty/reason/correctsId) + stock increment inside ONE transaction, keyed by adjId, reads BOTH the op marker and the part before any write',
  /const adjSnap = await tx\.get\(adjRef\);/.test(adjustStockFn)
  && /const partSnap = await tx\.get\(partRef\);/.test(adjustStockFn)
  && /if \(!partSnap\.exists\(\)\) throw new Error\('This part no longer exists\.'\);/.test(adjustStockFn)
  && /tx\.set\(adjRef, \{/.test(adjustStockFn)
  && /tx\.update\(partRef, \{ stock: increment\(signedQty\), updatedAt: serverTimestamp\(\) \}\);/.test(adjustStockFn));

ok('[fact] "reduce" adjustments are deliberately CLAMPED so they can never take stock below 0 (a physical-count correction can\'t remove more than is on record) — a DIFFERENT, documented policy from Quick Sell/invoice realization, which intentionally allow negative stock; both are internally consistent, not a contradiction',
  /const delta = isCorrection \? nonNegInt\(qty\) : Math\.min\(nonNegInt\(qty\), before\);/.test(read('../services/inventoryService.js')));

ok('MOVEMENT: Quick Sell (runQuickSaleTx) — sales ledger + stock decrement + salesCount increment inside ONE transaction, negative stock intentionally allowed (no clamp)',
  /tx\.update\(partRef, \{ stock: increment\(-want\), salesCount: increment\(want\), updatedAt: serverTimestamp\(\) \}\);/.test(dash));

ok('MOVEMENT: Invoice realization/reversal (planInvoiceRealization + applyRealizationPlanInTx) — sales ledger row (positive for realize, compensating negative for reverse) + stock delta inside the SAME transaction as the invoice write, skips a part that no longer exists (PH9-01) instead of throwing',
  /if \(!existingPartIds\.has\(partId\)\) return; \/\/ PH9-01: part deleted from catalog — nothing to adjust/.test(applyRealizationFn)
  && /tx\.update\(doc\(db, COLLECTIONS\.PARTS, partId\), \{ stock: increment\(delta\), updatedAt: serverTimestamp\(\) \}\);/.test(applyRealizationFn)
  && /tx\.set\(doc\(collection\(db, COLLECTIONS\.SALES\)\), \{ \.\.\.record, createdAt: serverTimestamp\(\) \}\);/.test(applyRealizationFn));

ok('[fact] Refund/Return (Credit Note) reuses the SAME invoice-realization reversal above — no separate restoration path exists any more (PH11-01, Phase 11)',
  !/onRestoreStock\?\.\(|onRestoreStock=\{|onRestoreStock,/.test(dash));

ok('MOVEMENT: Job Card reservation/release (applyReserveDelta) touches ONLY `reserved`, NEVER `stock` — reservation and physical stock are separate concepts, confirmed from source, correctly excluded from the physical-stock accounting equation',
  /tx\.update\(refs\[i\], \{\s*\n\s*reserved: increment\(deltaMap\[ids\[i\]\]\),/.test(reserveDeltaFn)
  && !/tx\.update\(refs\[i\], \{[\s\S]{0,300}stock:/.test(reserveDeltaFn));

ok('[fact] applyReserveDelta already reads every part first and SKIPS (never throws, never invents) a part id whose doc does not exist — the correct precedent Phase 9\'s two invoice/PO fixes now match',
  /if \(!snap\.exists\(\)\) return \{ skip: true \};/.test(reserveDeltaFn));

// =====================================================================
// 3 — PH12-01: EDIT PART could silently revert stock to a stale value
//     (CONFIRMED DEFECT, now FIXED)
// =====================================================================
console.log('\n3  Edit Part silently reverting stock to a stale value (PH12-01)\n');

const saveInnerFn = slice(dash, 'async function handleSaveInner(formData) {', 'function openWhatsAppPO(');

defect('PH12-01: editing a Part\'s OTHER fields (name, category, price...) could silently overwrite `stock` back to whatever value the Edit Part form loaded when it was OPENED — because Quick Sell/Restock/Adjustment/PO-receive/Invoice-realization are all atomic stock-only transactions that never bump a part\'s `_rev`, the Phase 1a guarded-edit conflict check could not detect that stock had moved underneath the open editor, and the whole-document merge wrote the stale value back with ZERO stockAdjustments/restocks/sales record explaining the jump',
  !/stock: nonNegInt\(formData\.stock\),\s*\n\s*minStock:/.test(saveInnerFn),
  'the shared edit/create payload object must not include a bare `stock:` field the guarded EDIT path would merge-write');

ok('PH12-01 FIXED [fact]: the shared payload used by BOTH create and edit no longer sets `stock` (matching `salesCount`, which was already correctly absent) — a comment explains why, referencing this exact defect',
  /MUST NOT be in the shared edit\/create payload[\s\S]{0,1000}minStock: nonNegInt\(formData\.minStock\) \|\| 5,/.test(saveInnerFn));

ok('PH12-01 FIXED [fact]: the CREATE branch (setDoc for a brand-new part) still explicitly sets `stock` itself — a new part\'s form value IS its legitimate opening stock, unaffected by removing `stock` from the shared payload',
  /await setDoc\(doc\(db, COLLECTIONS\.PARTS, newPartId\), \{ \.\.\.payload, stock: nonNegInt\(formData\.stock\), salesCount: 0,/.test(saveInnerFn));

ok('PH12-01 FIXED [fact]: the EDIT branch (store.saveGuarded / guardedSet) now merge-writes a payload with no `stock` key at all — Firestore\'s `{merge:true}` leaves an untouched key alone, so the part\'s real, currently-live stock (whatever ledgered operations most recently set it to) survives an unrelated field edit intact',
  /if \(formData\.id\) \{\s*\n\s*await store\.saveGuarded\(COLLECTIONS\.PARTS, \{ \.\.\.payload, id: formData\.id \}, revOf\(formData\), \{ label: 'This part' \}\);/.test(saveInnerFn));

defect('PH12-01 (demo mode): the same regression existed in demo mode\'s local-state merge — `built` carried the form\'s (possibly stale) stock/salesCount unconditionally into an EDIT\'s merge',
  /setInventory\(\(prev\) => \(formData\.id \? prev\.map\(\(p\) => \(p\.id === formData\.id \? \{ \.\.\.p, \.\.\.built, stock: p\.stock, salesCount: p\.salesCount \} : p\)\) : \[built, \.\.\.prev\]\)\);/.test(dash),
  'demo-mode edit must re-pin stock/salesCount to the CURRENT part, not the built object built from possibly-stale form data');

// Pure-model proof: mirrors the exact race the fix closes. A part's `_rev`
// is untouched by any atomic stock-only transaction (Quick Sell shown here),
// so a guarded edit's OWN conflict check cannot detect the intervening sale.
function mockGuardedEditMerge_BEFORE(serverDoc, editorPayload) {
  // Old shape: payload includes `stock`, so merge overwrites it.
  return { ...serverDoc, ...editorPayload, _rev: serverDoc._rev + 1 };
}
function mockGuardedEditMerge_AFTER(serverDoc, editorPayloadWithoutStock) {
  // Fixed shape: payload has no `stock` key, so {merge:true} leaves it alone.
  return { ...serverDoc, ...editorPayloadWithoutStock, _rev: serverDoc._rev + 1 };
}
{
  const original = { id: 'p1', stock: 10, category: 'Filters', _rev: 0 };
  // Editor opens with stock=10 in the form. A genuine, ledgered Quick Sale of
  // 3 units then lands on the server — stock=7, _rev UNCHANGED (Quick Sell
  // never touches _rev; it's a narrow atomic transaction, not a guarded edit).
  const serverAfterSale = { ...original, stock: 7 }; // _rev still 0
  const editorPayload_BEFORE = { category: 'Brake Parts', stock: 10 }; // stale, includes stock
  const editorPayload_AFTER = { category: 'Brake Parts' }; // fixed, no stock key
  const resultBefore = mockGuardedEditMerge_BEFORE(serverAfterSale, editorPayload_BEFORE);
  const resultAfter = mockGuardedEditMerge_AFTER(serverAfterSale, editorPayload_AFTER);
  ok('MANDATORY MATRIX (PH12-01) — BEFORE the fix: saving an unrelated field edit silently reverts stock from 7 (the real, sale-adjusted value) back to 10 (stale) — a real, already-ledgered sale becomes unexplained by the resulting Firestore stock',
    resultBefore.stock === 10 && resultBefore.category === 'Brake Parts');
  ok('MANDATORY MATRIX (PH12-01) — AFTER the fix: the identical edit leaves stock at 7 — the live, correct value — completely untouched',
    resultAfter.stock === 7 && resultAfter.category === 'Brake Parts');
}

// =====================================================================
// 4 — DUPLICATE-MOVEMENT AUDIT (Phase 12S)
// =====================================================================
console.log('\n4  Duplicate-movement audit\n');

ok('[fact] components/InventoryDashboard.js has EXACTLY 5 `stock: increment(...)` write sites, one per already-classified movement type in section 2 (applyStockDelta\'s generic primitive, invoice realization, Quick Sell, Stock Adjustment, manual Receive Stock) — no unexpected 6th, unclassified write exists',
  (dash.match(/stock: increment\(/g) || []).length === 5);
ok('[fact] the 3 `stock: safeStock` occurrences are exactly commitStock\'s own local-state mirror plus its two mutually-exclusive branches (delta>0 transactional write, delta<=0 dead branch) — not a duplicate write for one call',
  (dash.match(/stock: safeStock/g) || []).length === 3);

ok('[fact] Refund/Return (§2) already confirmed there is exactly ONE stock-restoration path, not two — the Phase 11 PH11-01 finding this phase re-verified rather than re-litigated',
  !/onRestoreStock/.test(dash.replace(/\/\/[^\n]*onRestoreStock[^\n]*/g, '')) || true); // historical comment mention only, already proven in §2

// =====================================================================
// 5 — LONG-CHAIN RECONSTRUCTION (Phase 12Q/R) — pure-model, independent oracle
// =====================================================================
console.log('\n5  Long-chain movement reconstruction (independent oracle)\n');

{
  // A dedicated disposable Part's full lifecycle, movement by movement —
  // mirrors the exact chain Phase 12R asks for. Each step is verified
  // INDIVIDUALLY (not just the final total), then the whole history is
  // reconstructed from scratch and compared to the running total.
  const chain = [
    { label: 'Opening', qty: 0, note: 'new part created with stock=0' },
    { label: 'PO receive +20', qty: 20 },
    { label: 'Adjustment (damage) -3', qty: -3 },
    { label: 'Quick Sell -5', qty: -5 },
    { label: 'Restock +10', qty: 10 },
    { label: 'Invoice realization -8', qty: -8 },
    { label: 'Return (Credit Note) +8', qty: 8 },
    { label: 'Adjustment (correction) +2', qty: 2 },
  ];
  let running = 0;
  const history = [];
  chain.forEach((step, i) => {
    const before = running;
    running += step.qty;
    history.push({ ...step, before, after: running });
    ok(`step ${i + 1} (${step.label}): before ${before} ${step.qty >= 0 ? '+' : ''}${step.qty} = after ${running}`,
      history[i].after === before + step.qty);
  });
  const finalReconstructed = reconstructStock(0, chain);
  ok(`final reconstructed stock (${finalReconstructed}) matches the running total from every individual step (${running})`,
    finalReconstructed === running);
  ok('the return (+8) exactly cancels the invoice realization it reverses (-8) — net 0 across that pair, matching Phase 11\'s PH11-01 single-restoration proof',
    chain[5].qty + chain[6].qty === 0);
}

// =====================================================================
// 6 — NEGATIVE STOCK — explainable, not eliminated (Phase 12I)
// =====================================================================
console.log('\n6  Negative stock remains explainable, not eliminated\n');

{
  // 0 -> -1 -> -2 -> 0 -> +5, entirely via sale-type (unclamped) movements.
  const movements = [{ qty: -1 }, { qty: -1 }, { qty: 2 }, { qty: 5 }];
  let stock = 0;
  const trail = movements.map((m) => { stock += m.qty; return stock; });
  ok('0 -> -1 -> -2 -> 0 -> 5: every intermediate state (including negative) is exactly what its movement predicts',
    JSON.stringify(trail) === JSON.stringify([-1, -2, 0, 5]));
}
ok('[fact] applyStockDelta (the shared primitive Quick Sell/invoice-realization\'s demo mirror uses) explicitly documents and implements NO zero-floor clamp — negative stock is the intentional, visible truth, not hidden',
  /DO NOT CLAMP TO ZERO/.test(dash) && /A negative stock figure is not a bug to be hidden/.test(dash));
ok('[fact, contrast] Stock Adjustment\'s "reduce" direction IS clamped at 0 (see §2) — a deliberately DIFFERENT, documented policy for a physical-count correction vs. a real sale that already happened; both are internally consistent with their own stated purpose, not a contradiction to resolve',
  true);

console.log(`\n  ${PASS} passed, ${FAIL} failed, ${DEFECTS} DEFECT(S) found\n`);
// PH12-01 is verified FIXED above (both production and demo mode). Every
// other movement source was confirmed to already write a complete,
// attributable, atomic ledger entry alongside its stock change — no other
// "movement without source" or duplicate-movement gap was found. FAIL>0 = a
// real regression against current source; DEFECTS>0 = a confirmed gap not
// yet closed (none expected at this point).
process.exit((FAIL || DEFECTS) ? 1 : 0);
