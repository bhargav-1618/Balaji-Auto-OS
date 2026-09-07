# Phase 21 — Malformed-Input / Data-Corruption Integrity

**Question.** Phase 18 asked *"can validation be bypassed?"*. This phase asks a
different one: **when malformed, extreme, or hostile-looking data *does* reach the
app — pasted into a field, forged into a document, left over from a legacy import —
does the app stay stable and keep its data intact all the way down the chain?**

```
input → persistence → read/list → search/filter → calculations → PDF/print → analytics/reports → downstream workflows
```

**Verdict.** One confirmed defect — **PH21-01 (HIGH)** — found and fixed. Everything
else is **SAFE / INTENTIONAL** (React's default escaping + CSP for HTML/script;
consistent `String(x ?? '')` / `|| []` / `|| ''` guards; append-only ledgers;
`billingService.toNum` finite-guards the money path; the Workshop PDF renders
fully-malformed data without throwing).

---

## 1. Input taxonomy (Phase 21A)

| Class | Cases exercised |
|---|---|
| **Text** | empty, whitespace-only, leading/trailing space, 10 000-char, repeated char, Japanese (`山田太郎`), Hindi (`ब्रेक पैड`), Arabic (`مرحبا`), emoji (`🚗🔧🚘`), combining (`é`), zero-width (`​`), RTL override (`‮…‬`), newline, tab, `<b>`, `<script>alert()</script>`, `<img onerror>`, `javascript:`, quotes/apostrophes/backslashes, `Ω≈ç√∫`, ligature `ﬀ` |
| **Numeric** | `0`, `1`, `-1`, `0.1/0.01/0.001`, `1e6…1e7`, `1e308`, 15-digit precision, `"NaN"`, `"Infinity"`, `"-Infinity"`, scientific `1e5`, empty, whitespace, **309-digit** and **400-digit** strings, `"  -12  "`, `"12abc"`, `"abc"` |
| **Identity / unique** | duplicate SKU / phone / email / registration / GST — behaviour unchanged from Phase 18 (see §11) |
| **Relationships** | missing / invalid / deleted / wrong / empty / malformed parent id (customerId, vehicleId, supplierId, partId, invoiceId) |

**Input surfaces inventoried:** every `<input type="number">` (54 across 7 files), the
free-text-sanitised numeric fields (billing invoice lines `replace(/[^\d.]/g,'')`,
job-card parts qty `replace(/\D/g,'')`), the CSV import mapper, the demo-mode
persistence path, and the Firestore documents an authenticated client can forge
(Phase 20).

---

## 2. Validation vs corruption vs vulnerability

The distinction held throughout:

```
"weird input"   ≠   "corrupt data"   ≠   "security vulnerability"
```

* `customer.name = "<script>alert(1)</script>"` stored as **plain text** and rendered
  by React (which HTML-escapes every string child) is **not a defect**. Verified: the
  codebase has **zero** `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`,
  `document.write`, `eval`, or `new Function` in application code, and a
  Content-Security-Policy (`next.config.js`) with `object-src 'none'`, no
  `'unsafe-eval'` in production, and a locked `script-src`.
* `stock = -3` is **not automatically corruption** — Phases 11/12/17 established that
  some negative stock is a real, intended state (it drives a "Negative stock" alert).
* The **defect** is the third link in this chain actually completing:

  ```
  pasted extreme value  →  survives coercion as Infinity/NaN  →  written to an
  authoritative Firestore field via increment()  →  unrecoverable
  ```

---

## 3. Text robustness (Phase 21B)

**SAFE.** Every text field has a length cap applied at the keystroke
(`.slice(0, N)` — name 100, notes 500, note-entry 300, regNo 13, VIN 17, GST 15,
engineNo 25, HSN 8, …) and multi-line paste is flattened where the field is
single-line (`sanitizeSingleLine`). Longer un-capped fields (company name,
occupation, invoice/PO notes) are bounded only by Firestore's 1 MiB document limit,
which is not reachable through a form.

| Consumer | Behaviour on a 10 000-char / Unicode / HTML-like string |
|---|---|
| List / table | CSS `truncate` (`overflow: hidden; text-overflow: ellipsis`) — row height unaffected |
| Search haystack | built once per data change, substring test — a long value is just a long string (§14) |
| Edit modal | value re-loads verbatim; `.slice()` cap re-applies only on a new keystroke |
| PDF | `doc.splitTextToSize(String(v), width).slice(0, N)` — bounded line count, width-aware `truncW` binary-search ellipsis |
| React render | text child → HTML-escaped; **no** script execution, **no** DOM injection |

No stored-data truncation observed beyond the intentional input caps.

---

## 4. Unicode / emoji / international text (Phase 21D)

**SAFE.** Firestore stores UTF-8 natively; the emulator round-trips
`"ब्रेक​ पैड 🔧🚗"` (Devanagari + ZWSP + emoji) byte-for-byte. `safeLower` does
`(val || '').toString().toLowerCase()`; `normalizeText` / `tokenize` / `normId` all
start `String(x ?? '')`. Byte-length ≠ character length is never assumed —
`isIndianMobile('🚗'.repeat(10))` is correctly `false` (it tests digit structure,
not `.length`). The search slang map even contains Telugu terms (`'బ్రేక్' → 'brake'`).
`tsToDate` (the "invoice paid but every list empty" root cause) returns `Date | null`
for every junk input and never throws.

---

## 5. HTML / script-like input (Phase 21C)

**SAFE — rendered, not executed.** `<script>alert("test")</script>`,
`<img src=x onerror=alert(1)>`, `<iframe>`, `javascript:…` are stored as text and
displayed as text. Confirmed by construction (no HTML-injection API in the code) and
by rendering the Workshop PDF with `<script>` in every text field — it draws the
literal characters. `isValidEmail` rejects a `<script>…</script>` string (no `@`) but
deliberately **does not** claim to reject every RFC-invalid local-part character —
that is a validation nicety, not a security boundary, because the value is never
interpreted as markup.

---

## 6. Very long strings (Phase 21E)

**SAFE.** Input caps (§3) plus: the PDF's `splitTextToSize(...).slice(0, N)` bounds
every wrapped block to N lines; `truncW`'s binary search is `O(log n)` in string
length; search is a single `String.prototype.includes`. A 10 000-char part name
feeds the analytics `frac()` fraction unchanged (it is counted, not measured).

---

## 7. Numeric corruption (Phase 21F) — **DEFECT: PH21-01**

### The chain

1. `<input type="number">` **accepts** a pasted **309-digit** string as a valid
   value and keeps it in `.value` (verified in Chromium: a value that still parses to
   a *finite* double is retained; only a value that would be `Infinity` — 310+ nines,
   `1e309` — is cleared to `""`).
2. `parseInt` / `parseFloat` / `Number` of that 309-digit string **overflow to
   `Infinity`**.
3. The old write-boundary clamps —
   `nonNegInt = Math.max(0, parseInt(v,10) || 0)`,
   `nonNegNum = Math.max(0, parseFloat(v) || 0)`,
   `sanitizeStock = Math.max(0, Math.floor(Number(v) || 0))`, and the inline copies in
   `RestockModal` / `BulkReceiveModal` / `CheckoutModal` / demo part-save /
   `SupplierPOBuilder` — let that `Infinity` **straight through** (`Infinity || 0` is
   `Infinity`; `Math.max(0, Infinity)` is `Infinity`).
4. **Receive Stock has no upper bound** (receiving legitimately can't be capped), so
   `tx.update(partRef, { stock: increment(Infinity) })` runs.
5. Emulator-verified: `increment(Infinity)` sets the part's `stock` to `Infinity`;
   `increment(NaN)` sets it to `NaN`; and **a later `increment(5)` on a `NaN` field
   stays `NaN`**. Edit Part's stock field is read-only ("change stock via
   Sell/Receive"), so the field is **unrecoverable from the UI**.

A pasted **`1e308`** (finite, so the input keeps it) instead survived as `1e308`
through `nonNegNum`, and the Inventory Valuation report's
`b.value += num(stock) * num(sellingPrice)` then **overflowed a whole category's
total to `₹∞`**, its margin to `NaN`, and its CSV/PDF export cell to blank —
reproduced end-to-end against real demo data (one part, `sellingPrice = 1e308`).

### Where it did *not* reach

* **The money / ledger engine is immune.** `billingService.toNum` already does
  `Number.isFinite(n) ? n : 0`, so a pasted 400-digit rate in a billing invoice line
  coerces to `0`, and `invoiceTotals` / `invoiceStatus` / realization stay finite and
  self-consistent. Confirmed with an "evil invoice" (`qty`/`rate`/`disc`/`gst` all
  malformed): `sub/gst/grand/paid/balance` all finite, `balance ≥ 0`.
* **Quick Sell qty**, **Adjust "reduce" qty**, and **Bulk Adjust qty** are bounded by
  a `qty > stock` check that rejects `Infinity`.
* **Adjust "correction" qty** was safe by accident — `computeStockAdjustment` calls
  `nonNegInt(qty)`, and `parseInt(Infinity, 10)` → `parseInt("Infinity", 10)` → `NaN`
  → `0`. (Hardened anyway for clarity.)
* **PO receive** is caught by `applyPoReceive`'s over-receipt rejection *provided the
  ordered qty is finite* — which is why `SupplierPOBuilder`'s qty setter is also
  fixed.

### Fix

Finite-guard **and** magnitude-clamp the three shared service coercers, then route
the inline copies through them. Full detail in §24 / §28.

```js
const clampNonNeg = (n) => (Number.isFinite(n) && n > 0 ? Math.min(n, Number.MAX_SAFE_INTEGER) : 0);
export const nonNegInt    = (v) => clampNonNeg(parseInt(v, 10));
export const nonNegNum    = (v) => clampNonNeg(parseFloat(v));
export const sanitizeStock = (v) => clampNonNeg(Math.floor(Number(v)));
// lib/format.js — display coercion, now matches toNum():
export const num = (n) => { const v = Number(n); return Number.isFinite(v) ? v : 0; };
```

`Number.MAX_SAFE_INTEGER` (≈ 9 × 10¹⁵) is not a business rule — it is "reject a
physically impossible magnitude", exactly what `nonNegNum`'s own doc-comment already
claimed ("guards against … pasted junk"). Every real value ≤ 9 quadrillion is
untouched; `9e15 × 9e15 = 8.1e31` keeps every downstream `stock × price` sum finite.

---

## 8. Negative numbers (Phase 21G)

**SAFE / INTENTIONAL.** Per Phase 11/12/17 semantics:

| Field | Negative? |
|---|---|
| invoice line `qty` / `rate` / `disc` | not typeable (`replace(/[^\d.]/g,'')` strips `-`); `toNum` would accept a stored negative (refund delta) but `invoiceTotals` floors line net at `Math.max(0, …)` |
| part `stock` (form) | `type=number min=0` + `blockInvalidNumberKeys` (blocks `-`); `sanitizeStock` clamps `< 0 → 0` |
| part `purchasePrice` / `sellingPrice` / `mrp` | `nonNegNum` clamps `< 0 → 0` |
| stock **adjustment** | "reduce" is stored as a negative signed delta *by design*; magnitude is `Math.min(nonNegInt(qty), onHand)` — never drives stock below 0 |
| stock **correction** | additive; `nonNegInt` clamps a negative qty to 0 (existing test) |
| CSV import | negative rows *rejected* (`if (stock < 0) …`) — though `num()` strips `-` first, so the check is defensive-only (documented, harmless) |

Nothing here changed.

---

## 9. Decimal quantities (Phase 21H)

**INTENTIONAL — integer domain.** `nonNegInt` / `parseInt` truncate; part `stock` is
`Math.floor`ed; job-card and PO qty use `parseInt`. Billing invoice line `qty`
**does** allow decimals (`inputMode="decimal"`, `replace(/[^\d.]/g,'')`) — a labour
"hours" line is legitimately fractional (`2.5 hr`). No silent truncation that
contradicts the field's own contract; no change.

---

## 10. Extreme values (Phase 21I)

Covered by the PH21-01 fix. Post-fix: `1e6 … 1e9` unaffected; a pasted `1e308` or
309-digit string clamps to `MAX_SAFE_INTEGER` at every stock/price write boundary and
to `0` where it overflowed to `Infinity`. Category and grand totals stay finite;
scientific-notation display, precision, PDF and analytics all hold. Verified with
emulator + pure-model tests (no economically-unrealistic production transaction
created).

---

## 11. Duplicate unique values (Phase 21J)

**SAFE — unchanged from Phase 18.** Customer phone/GST uniqueness (fixed in PH18-01),
vehicle registration/VIN/engine, part SKU, supplier name — all keyed through the
normalising helpers (`phoneKey` = digits only, `regKey` = upper + strip
`[\s\-/]`, `normId` = trim + lower + strip whitespace, `safeLower`). `ABC123`,
`abc123`, and `ABC 123` all collide. Quick-create paths (billing, vehicles) carry the
same checks (PH18-01). No new work.

---

## 12. Missing fields / null-like data (Phase 21K)

**SAFE.** `missing` vs `null` vs `undefined` vs `''` are not conflated where it
matters: `?? ` (nullish) is used for "value present but falsy" cases (`qty ?? quantity ?? 0`),
`|| []` / `|| ''` / `|| 0` for "treat any falsy as absent". `undefined` is the **only**
value Firestore rejects on write (emulator-verified) — so a code path that produced
`undefined` in a field would *fail the write* (toast shown, nothing persisted), which
is fail-safe, not corruption. A record that stores but crashes a downstream screen was
specifically hunted: every list/detail/report/PDF consumer guards with `|| []` /
`String(x ?? '')` / `tsToDate(x) → Date|null`; `analyticsService` was fed an "evil
parts + evil sales" set (`stock:'1e308'`, `minStock:'NaN'`, `sellingPrice:'abc'`,
`name` 9 000 chars, `createdAt:'not-a-date'`) — `computeInventoryHealth`,
`computeWorkshopScore`, `computeInsights`, `computeAlerts` each returned a
well-formed, finite result without throwing.

---

## 13. Relationship corruption (Phase 21L)

**SAFE — fallback, not repair.** A missing / stale `customerId` / `vehicleId` /
`supplierId` / `partId` does not crash any consumer: the Workshop PDF renders with
`cust = null` / `veh = null` (the "record deleted after the invoice was raised" case
is an existing stress fixture); `computeAlerts` skips a customer with no vehicles;
line-category logic falls back to `SERVICE`. Malformed historical references are
**not** auto-repaired (Phase 9/10 policy); the intended behaviour is "show what's
there, degrade gracefully".

---

## 14. Search robustness (Phase 21M)

**SAFE.** The search core (`lib/search.js` + `lib/useSearch.js`) is pure
substring/token matching:

* No user input is ever compiled into a `RegExp` — the only `new RegExp` in the code
  (`jobCardService.nextJobCardNumber`) escapes its input
  (`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`) and the pattern is `^prefix\d+$` (no
  catastrophic backtracking).
* `matchTokens` / `rankIndexed` / `normId` / `normalizeText` all begin
  `String(x ?? '')`; a `null`, `undefined`, number, or object query is a safe no-op.
* Exact/prefix/suffix/contains tiers, no fallback tier → no duplicate results.
* Haystack built once per data change → no O(n·m) per keystroke; a 20 000-char
  haystack vs a 5 000-char query still returns a number and terminates.
* Pagination/filter integrity is Phase 16's remit and is unaffected.

Tested with the full text taxonomy (emoji, RTL, zero-width, 10 000-char, HTML-like)
plus `undefined` / `null` / number / `{}` as the query — no throw, no hang.

---

## 15. Analytics / report robustness (Phase 21N)

**SAFE.** `analyticsService` coerces every numeric field it touches
(`Number(x) || 0`, `Math.round`, `Math.min/max`, clamped `0–100` on both scores) and
formats via `₹${Math.round(num(n)).toLocaleString('en-IN')}`. With `num()` now
finite-guarded, a stored `NaN` / `Infinity` (forge or legacy) renders as `₹0`, not
`₹∞` / `₹NaN`. The Inventory Valuation report's category total was the one place a
*finite-but-huge* stored value could still overflow a product — closed at the write
boundary (§7). "Evil data" run: dashboard scores, insights list, and alert list all
finite and well-formed.

---

## 16. PDF / print robustness (Phase 21O) — **mandatory**

**SAFE — verified by rendering, not by regex.** `lib/workshopInvoicePdf.js` was
rendered in-process (real `jsPDF`, real module) from a fully-malformed invoice:

* every text field = 400-char Japanese + `<script>alert(1)</script>` + 40 emoji +
  zero-width chars + Arabic
* `line.qty = "9".repeat(400)`, `line.rate = "1e308"`, `line.rate = Infinity`,
  `gst = "abc"`, `purchasePrice = -5`
* `totals` = `{ sub: NaN, grand: Infinity, gst: NaN, balance: NaN, … }`

→ **2-page PDF, ~14 KB, no throw.** It uses `String(v)`, `splitTextToSize(...).slice(0, N)`,
width-aware `truncW`, and `num()` for every number. With `num()` finite-guarded, an
`Infinity` rate now prints as `0`, consistent with the customer-facing total the
money engine computes from the same field (previously the Workshop copy would have
printed `Rs. ∞`). No missing financial fields, no raw executable HTML, no layout
break beyond the intentional truncation.

---

## 17. Round-trip integrity (Phase 21P)

**SAFE.** `nonNegNum(nonNegNum(x)) === nonNegNum(x)` and
`normalizeText(normalizeText(x)) === normalizeText(x)` for the entire taxonomy — no
progressive drift on re-save. Intentional normalisation (whitespace collapse in
`normalizeText`, `-`/`+`/`e` stripping in the number-field `onChange`, digit-only
phone keys, upper-cased registrations) is classified as **normalisation**, distinct
from corruption. No character loss, no precision loss, no type flip on a legitimate
value.

---

## 18. Import / bulk robustness (Phase 21R)

**SAFE.** The CSV/XLSX import (`InventoryImportModal`) has its **own**
finite-guarded numeric coercion —
`num = v => { const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g,'')); return Number.isFinite(n) && n >= 0 ? n : 0; }`
— so a `9`×400 or `Infinity` cell becomes `0`, never `Infinity`. Rows are validated
before write (negative stock/price, MRP < cost, floor > MRP rejected with a reason);
**invalid rows are skipped, valid rows continue** (non-atomic, chunked at 450, and
`rejected[]` is surfaced to the user). Long strings, Unicode, HTML-like text and
duplicates behave exactly as the interactive path. Unexpected columns are ignored by
the column mapper.

---

## 19. Demo / prod parity (Phase 21S)

Was a real gap: demo part-save used inline `Number(x) || 0` while production used
`nonNegNum`/`nonNegInt`. **Fixed** — demo now calls the same
`sanitizeStock`/`nonNegInt`/`nonNegNum`. (`localStorage`'s `JSON.stringify` already
maps `Infinity`/`NaN` → `null` and drops `undefined`, so demo was never *corrupted*,
just inconsistent; now it normalises identically.)

---

## 20. Failure / retry results (Phase 21T)

**SAFE — unchanged from Phase 5/6.** A failed / timed-out / interrupted write leaves
no partial record: single-document transactions are atomic; the durable-opId +
in-transaction "already applied?" read makes a retry-after-ambiguous-response
exactly-once. A malformed value that survives to the write is now finite (post-fix),
so a retry re-applies the same finite value. Not re-tested in full (Phase 5/6's remit).

---

## 21. Firestore verification (Phase 21W)

Emulator probe of the raw SDK / persistence behaviour:

| Written value | Result |
|---|---|
| `NaN` in a numeric field | **persists as `NaN`** (Firestore supports NaN) |
| `Infinity` / `-Infinity` | **persists** (SDK does *not* reject it) |
| `undefined` | **rejected** — `FirebaseError: Unsupported field value: undefined` (the write throws; nothing persists) |
| `null` | persists |
| `1e308`, `1e-9`, `-50`, `"1e5"` (string) | persist as-is |
| `increment(Infinity)` / `increment(NaN)` on `stock` | field becomes `Infinity` / `NaN`; **a later `increment(5)` on `NaN` stays `NaN`** |
| 20 000-char string, emoji + ZWSP + Devanagari, 5-level nested object | persist intact |

**Conclusion:** Firestore is *not* a backstop for `NaN`/`Infinity` — only for
`undefined`. The guarantee "no authoritative numeric field becomes NaN/Infinity" has
to be enforced in application code, which is what the PH21-01 fix does at the write
boundary. For every *rejected* malformed value tested (a bad shape that fails the
write), **nothing was persisted**.

---

## 22. Confirmed defects

| ID | Severity | Summary |
|---|---|---|
| **PH21-01** | **HIGH** | A pasted 309-digit number (accepted by `<input type="number">`, overflowed to `Infinity` by `parseInt`/`parseFloat`) passed straight through the write-boundary clamps into `stock: increment(Infinity)` via Receive Stock (no upper bound) → part `stock` permanently `Infinity`/`NaN`, unrecoverable from the UI. A pasted `1e308` overflowed the Inventory Valuation report's category + grand totals to `₹∞`/`NaN` and broke its CSV/PDF export. The money/ledger engine (`toNum`) was unaffected. |

No CRITICAL. No script execution. No other MEDIUM/LOW **defects** — see §29 for
items classified INFO.

---

## 23. Root causes

1. **`nonNegInt` / `nonNegNum` / `sanitizeStock` (services/inventoryService.js) and
   `num` (lib/format.js) lacked the `Number.isFinite` guard** that their sibling
   `billingService.toNum` has had all along. `Number(n) || 0` maps `NaN → 0` but
   `Infinity || 0 → Infinity`.
2. **No upper-magnitude clamp**, so a finite-but-absurd `1e308` (which the browser's
   number input *does* retain) survived and overflowed a downstream product.
3. **Duplicated inline copies** of the same weak idiom
   (`Math.max(0, parseInt/parseFloat(x) || 0)`) in `RestockModal`,
   `BulkReceiveModal`, `CheckoutModal`, `StockAdjustModal`, the demo part-save, and
   `SupplierPOBuilder` — so hardening the shared helper alone was not enough.

---

## 24. Fixes

All in the service / lib layer plus routing the inline copies through it — **no new
files, no new abstractions, net negative on distinct coercion expressions**.

| File | Change |
|---|---|
| `services/inventoryService.js` | new `clampNonNeg(n)` (finite-guard + `MAX_SAFE_INTEGER` clamp, negatives → 0); `nonNegInt` / `nonNegNum` / `sanitizeStock` re-expressed through it; `cardReservedQtys` uses `nonNegInt(p.qty)` (feeds `reserved: increment`); `buildRestockRecord` uses `nonNegNum` for qty + unitCost |
| `lib/format.js` | `num` → `{ const v = Number(n); return Number.isFinite(v) ? v : 0; }` (was `Number(n) || 0`) — display/report/PDF coercion now matches `toNum` for non-finite input |
| `components/InventoryDashboard.js` | `RestockModal` (`n`, `cost`), `CheckoutModal` (`rawQ`, `p`, `rawQty`), `StockAdjustModal` (`q` ×2), `BulkReceiveModal` (`totalUnits`, `totalCost`, `canSubmit`, `priceDiffers`, `onSubmit` line map), demo part-save (`stock`/`minStock`/`purchasePrice`/`sellingPrice`/`minSellingPrice`) — all routed through `nonNegInt` / `nonNegNum` / `sanitizeStock` |
| `components/inventory/SupplierPOBuilder.jsx` | `setQty` finite-guards `Number(v)` and clamps to `MAX_SAFE_INTEGER` (was `Math.max(1, Math.round(v) || 1)`) so a pasted huge qty can't make the PO total read `₹∞` |

**Not touched:** `billingService.toNum` (already correct); billing invoice-line
inputs (money path immune; the `num()` fix handles the Workshop-PDF display); the
CSV importer (own finite-guarded `num`); Firestore rules (no rules change).

---

## 25. Automated tests

* **New:** `tests/malformed-input-integrity.test.cjs` — **227** assertions, all with
  independent oracles (never "assert the coercer equals itself"). Covers: numeric
  coercion at the write boundary; stock-adjustment / reservation / restock math;
  money-path immunity (`toNum` / `invoiceTotals` / `stockDelta` / `ledgerDelta` on an
  "evil invoice"); search primitives on the full text taxonomy + non-string queries;
  `computeInventoryHealth` / `computeWorkshopScore` / `computeInsights` /
  `computeAlerts` on evil data; `num()` ↔ `toNum()` parity; text helpers
  (`safeLower` / `isValidEmail` / `isIndianMobile` / `tsToDate` / `formatINR`);
  round-trip idempotence; **and an in-process Workshop-PDF render from
  fully-malformed data**.
* **Updated:** `tests/validation-bypass-integrity.test.cjs` §5 — the independent
  `clampInt` / `clampNum` oracle now rejects non-finite + clamps magnitude (matching
  the hardened service); added `9`×309, `9`×400, `1e308`, `"Infinity"` cases + two
  explicit PH21-01 assertions.

Regression gates:

| Gate | Result |
|---|---|
| `npm test` | **142 / 142 test files** (was 141 + the new file), 0 failed |
| `npm run test:rules` | **2 / 2 files, 261 assertions** (150 + 111), 0 failed — no rules change |
| `npm run lint` | 0 errors (71 pre-existing `<img>` / exhaustive-deps warnings only) |
| `npm run build` | ✓ Compiled successfully |

---

## 26. Live website validation

Performed against the running app in **demo mode** with a single disposable part
(`ZZ-QA-PH21-EVIL`, `sellingPrice = 1e308`) injected into demo session storage:

1. Long-text / Unicode / emoji record displays — the part renders in every list with
   CSS truncation; layout intact.
2. HTML/script-like text renders as text (React escaping) — no execution
   (`read_console_messages` clean).
3. Unusual numeric input does not crash the screen — the dashboard's Inventory Health
   / Workshop Score panels re-computed to finite values; the injected part only
   lowered the score (missing supplier/image), it did not `NaN` it.
4. **Before the fix**: a faithful replay of `InventoryReports.jsx`'s `built.valuation`
   against the real demo inventory returned `Brake Pad → value ₹∞, profit ₹∞,
   margin NaN, grand total ₹∞, CSV cell null`.
5. **After the fix**: a part saved through the hardened write boundary carries
   `sellingPrice ≤ MAX_SAFE_INTEGER`, and the same computation stays finite.
6. Search located the unusual part name; PDF and report pages remained functional.

No real production business data was created, mutated, or deleted.

---

## 27. QA cleanup

| Item | Status |
|---|---|
| `ZZ-QA-PH21-EVIL` demo part (session-storage only, never touched Firestore) | **removed** — verified `maruti_demo_inv` back to its seeded count, no `ZZ-QA-PH21*` rows |
| legacy `maruti_inventory_demo` localStorage key (accidentally created during probing, app never reads it) | **removed** |
| `tests/rules/_tmp/` probe scripts | **removed** |
| temp PDF-probe scripts | **removed** |
| production Firestore | untouched — probes ran only against the emulator (`demo-rules-test`) |

`git status` clean apart from the 4 production files, 1 updated test, and 1 new test
listed in §24/§25.

---

## 28. Code-growth review

```
Production lines added:    ~28   (mostly the shared clampNonNeg helper + its comment block + PH21 one-liners)
Production lines removed:   ~14   (the divergent inline Math.max(0, parseInt/parseFloat …) copies)
Net production change:      +14 lines, of which ~11 are comments

New production functions:   1  (clampNonNeg — private, 1 line, in inventoryService.js)
New production files:       0
New abstractions:           0
```

**Existing mechanisms reused:** `Number.isFinite` (the exact discipline
`billingService.toNum` already used); the already-pure `nonNegInt` / `nonNegNum` /
`sanitizeStock` service helpers (6 call sites that had drifted to inline copies are
now routed back through them).

**Unnecessary code removed:** 5 hand-copied `Math.max(0, parseInt/parseFloat(x) || 0)`
expressions.

**Significant new logic:** none. The one new line of logic
(`Number.isFinite(n) && n > 0 ? Math.min(n, MAX_SAFE_INTEGER) : 0`) is a tightening of
a clamp that already existed and already claimed in its doc-comment to guard "pasted
junk".

**Why the existing mechanism couldn't safely handle it:** `Math.max(0, x || 0)`
treats `Infinity` as a valid non-negative number, and `Number(n) || 0` passes
`Infinity` through. Both needed the `Number.isFinite` check that only `toNum` had.

---

## 29. Remaining limitations

| # | Item | Classification |
|---|---|---|
| L-1 | A part whose `sellingPrice` was set to a finite-but-huge value (e.g. `1e308`) **before this fix** and never re-saved would still overflow the Valuation report. `num()` is finite-guarded but not magnitude-clamped (it must permit large legitimate aggregates and negative deltas). Self-heals on the next edit of that part (re-save clamps to `MAX_SAFE_INTEGER`). No such data exists in production. | INFO — documented residual, not a live defect |
| L-2 | An **authenticated** client can still forge a Firestore document with `NaN` / `Infinity` / a wrong-typed field directly (Phase 20 classified the operational collections as `signedIn`-writable with no shape rule). `num()` / `toNum()` neutralise it in every read path (report → `₹0`, PDF → `0`), and `computeWorkshopScore`'s `qtyOf(s.qty ?? s.quantity ?? 0)` would concat-`NaN` a forged **string** `qty` — but there is **no input surface** for this; it is an authorization concern already in Phase 19/20's scope. | INFO — not a Phase 21 input defect |
| L-3 | The CSV importer's explicit "negative stock/price" rejection branches are unreachable because its own `num()` strips `-` before the check. Harmless (value becomes non-negative), left as defensive code. | INFO |
| L-4 | Un-capped free-text fields (company name, occupation, PO/invoice notes) are bounded only by Firestore's 1 MiB doc limit. Not reachable through a form; no corruption, only a theoretical very-long value. | INFO |
| L-5 | `firestore.rules` is unchanged by this phase. The separately-tracked `auditLog` field-clause deployment gap (PH15-03 + PH20-01) is still owner-action-pending and is **not** in Phase 21's scope. | carried forward |

---

## 30. Final PASS/FAIL assessment

**PASS**, with one HIGH defect fixed.

```
Ugly input
   → safely rejected / normalised  (nonNegInt/nonNegNum/sanitizeStock/num + input caps + React escaping)
   OR safely persisted             (Firestore stores Unicode/emoji/long text intact)
   → Firestore stays valid         (no NaN/Infinity in an authoritative field from any input path)
   → UI stays stable               (|| [] / String(x??'') guards; ErrorBoundary; verified live)
   → search stays stable           (pure substring/token, no user RegExp, no O(n·m))
   → analytics stays stable        (Number()||0 + clamped scores; num() finite-guarded)
   → PDF stays stable              (String(v) + splitTextToSize.slice; rendered from evil data, no throw)
```

The one place the chain actually broke — a pasted extreme number reaching
`stock: increment(Infinity)` and the Valuation report's totals — is closed at the
write boundary by finite-guarding and magnitude-clamping the coercers that already
existed for exactly this purpose, and by routing the drifted inline copies back
through them.
