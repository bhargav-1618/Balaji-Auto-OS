# Phase 22 — PDF / Export Integrity

**Purpose.** Output integrity, not "the file opened". For every export path the app
has, compare the generated output against the **authoritative** source
(Firestore / the app's own calculation), record-for-record and value-for-value.
The central deliverable is the three-way comparison for invoices:

```
        authoritative record (Firestore / demo store)
                        │
        independent hand-calculation  ── never derived from the PDF
                        │
        the generated output's real bytes  ── text pulled back out of the PDF stream
                        ▼
     all three must state the same amounts, identities and record set
```

**Outcome.** Four defects found and fixed — two MEDIUM, two LOW. None silently
omitted, duplicated or misattributed a record; the money that was wrong was wrong
in a *derived aggregate re-implementation* (PH22-01), and the text that was lost was
lost to an *ellipsis-less truncation* (PH22-04). The primary invoice PDF, the
invoice XLSX, the QR payload and the `/verify` page were verified — automated **and**
live in demo mode against real rendered bytes — to match the authoritative data
exactly.

| ID | Sev | One-line |
|---|---|---|
| **PH22-01** | MEDIUM | `billingService.invoiceTotals` was a simplified model (ignored invoice discount, `gstMode`, the per-line-GST→`gstPct` fallback) → the **Vehicle Report "Revenue"** export summed a grand total that disagreed with the invoice's own for any discounted / GST-exempt invoice. |
| **PH22-02** | MEDIUM | The invoice-PDF generators used `iv.lines || []` / `iv.payments || []` — a wrong-type (truthy non-array) field **crashed PDF generation** (the PH21-D1 class, in the one path PH21-D1's sweep did not reach). |
| **PH22-03** | LOW | Status vocabulary split: `invoiceStatus` / `invStatus` said `"Pending"`, every user-facing surface + the Billing export said `"Unpaid"` → the **same** unpaid invoice printed as "Pending" in the Reports→Billing export and "Unpaid" in the Billing export. |
| **PH22-04** | LOW | Customer-copy invoice PDF + Purchase-Order PDF hard-cut line descriptions at `.slice(0, 52)` **with no ellipsis**, while the workshop copy of the same invoice wraps the full text — one invoice, two representations, one silently losing characters. |

No `firestore.rules` change. Gates green. Deployed.

---

## 1. Export paths discovered (source-mapped)

| # | Output | Generator | Authoritative source it must match |
|---|---|---|---|
| 1 | **Customer-copy invoice PDF** | `BillingModule.drawInvoiceDocument` (non-workshop branch) | `totalsOf(iv)` + `deriveStatus(iv)` from `iv.lines` / `iv.payments` |
| 2 | **Workshop-copy invoice PDF** | `lib/workshopInvoicePdf.renderWorkshopInvoicePdf` | same `totalsOf` / `deriveStatus`, passed in by the caller |
| 3 | **Combined / bulk invoice PDF** | `BillingModule` — `drawInvoiceDocument` in a loop, `addPage()` between | per-invoice, as #1/#2 |
| 4 | **Invoice list XLSX** | `BillingModule.exportCSV` → `lib/exportSheet.writeSheet` | `totalsOf` + `deriveStatus` per row; row set = `filtered` (searched + filtered, not paged) |
| 5 | **Bulk invoice XLSX** (selection) | `BillingModule.bulkExport` → `writeSheet` | selection resolved against the **full** list (`lib/selectionScope`) |
| 6 | **Job Card PDF** | `JobCardModule.drawJobCardDocument` | `Σ qty·rate` (parts + labour) — a labour **estimate**, deliberately *not* a taxed financial document |
| 7 | **Purchase Order PDF** | `SupplierPOBuilder.downloadPDF` | per-supplier `Σ qty·unitCost` + configured GST % |
| 8 | **Customer Report** (XLSX + PDF) | `CustomersModule.buildCustomerExport`, `pdfTheme.exportReportPDF` | stored aggregates `num(c.totalSpent)` / `num(c.outstanding)` |
| 9 | **Vehicle Report** (XLSX + PDF) | `VehiclesModule.buildVehicleExport` → `lib/vehicleStats.revenueOf` | realized invoices' `invoiceTotals(iv).grand` — **PH22-01 lived here** |
| 10 | **Reports tab** — Inventory Valuation, GST / GSTR-1, Billing, Top Parts, Technician Perf, … | `pdfTheme.exportReportPDF` + `writeSheet`, from the same `{head, rows}` array | each report's own on-screen rows |
| 11 | **QR payload** → `/verify` page | `lib/pdfQr.buildQrPayload` / `makeQrDataUrl`; `pages/verify.js` | invoice summary only — no line items / payments / cost / profit |
| 12 | *(no standalone CSV)* | — | the app migrated CSV → real `.xlsx`; `exportCSV` is a misnamed function that writes an XLSX |

---

## 2. Three-way invoice comparison — the core check

### 2A. Automated — `tests/pdf-export-integrity.test.cjs` (125 assertions)

- An **independent `oracle(iv)`** re-derives line-net / invoice-discount / `gstMode` /
  `anyLineGst` fallback / rounding / payment state **by hand from the brief's formula**
  — it never calls `totalsOf`. A bug shared by `totalsOf` *and* the PDF still fails here.
- The "generated output" is the **real PDF bytes**: `renderWorkshopInvoicePdf` is run
  in-process and every drawn string is pulled back out of the content stream
  (`(…) Tj`), then matched string-for-string against `money(oracle.X)`.
- Scenarios: **unpaid**, **partial payment**, **full payment (two payments)** —
  `oracle ↔ totalsOf ↔ invoiceTotals ↔ PDF text` all equal for grand / paid / balance,
  and `oracleStatus ↔ deriveStatus ↔ invoiceStatus` all equal.

### 2B. Live — demo mode, real rendered PDFs (Browser pane, `?demo=1`)

**INV-0171** (existing paid invoice). Authoritative (from the app's own edit view):

| field | app / Firestore | independent calc | **generated PDF** |
|---|---|---|---|
| Part 1 | Toyota Glanza Engine Oil 5W-30 · 4 × 679.00 | 2 716.00 | `Rs. 2,716.00` ✓ |
| Part 2 | Kia Seltos Brake Pads · 2 × 1 447.00 | 2 894.00 | `Rs. 2,894.00` ✓ |
| Labour | Pressure Wash | 524.00 | `Rs. 524.00` ✓ |
| Subtotal | 6 134.00 | 2716+2894+524 = 6 134.00 | `Rs. 6,134.00` ✓ |
| GST | ₹1 009.80 (CGST 504.9 + SGST 504.9) | 5610 × 18 % = 1 009.80 | `Rs. 1,009.80` ✓ |
| Round Off | 0.20 | 7144 − 7143.80 | `Rs. 0.20` ✓ |
| Grand Total | ₹7 144 | round(7143.80) = 7144 | `Rs. 7,144.00` ✓ |
| Paid / Balance | 7 144 / 0 (Card) | 7 144 / 0 | `Rs. 7,144.00` / `Rs. 0.00` ✓ |
| Status | PAID | Paid | (badge) PAID ✓ |

**INV-0297** (QA draft created in demo mode — Unicode customer, 166-char line):

| field | app / demo store | independent calc | **generated PDF** |
|---|---|---|---|
| Line | qty 3 × 1 234.56 | 3 703.68 | `Rs. 3,703.68` ✓ |
| Subtotal | 3 703.68 | 3 703.68 | `Rs. 3,703.68` ✓ |
| GST | ₹666.66 | 3703.68 × 18 % = 666.66 | `Rs. 666.66` ✓ |
| Round Off | −0.34 | 4370 − 4370.34 | `Rs. -0.34` ✓ |
| Grand Total | ₹4 370 | round(4370.34) = 4370 | `Rs. 4,370.00` ✓ |
| Balance | 4 370 (Draft, unpaid) | 4 370 | `Rs. 4,370.00` ✓ |

**Every money value in both PDFs matched the authoritative record and the
independent calculation.** Neither expected value was read off the PDF.

---

## 3. Per-path classification

| Path | Verdict | Notes |
|---|---|---|
| Customer-copy invoice PDF — money | **MATCHES AUTHORITATIVE DATA** | 2A + 2B; every figure via `totalsOf` |
| Customer-copy invoice PDF — line description | **DEFECT → FIXED (PH22-04)** | was silent `.slice(0, 52)`; now width-aware `truncW` with `…` |
| Workshop-copy invoice PDF — money | **MATCHES AUTHORITATIVE DATA** | shares `totalsOf` result; 2A |
| Workshop-copy invoice PDF — wrong-type field | **DEFECT → FIXED (PH22-02)** | `asArray` guards on `lines` / `payments` / `statusLog` / `complaints` / `diagnosis` / `cust.vehicles` |
| Combined / bulk invoice PDF | **MATCHES** | thin wrapper over `drawInvoiceDocument`; `tests/billing-combined-pdf.test.cjs` |
| Invoice list XLSX — values | **INTENTIONAL TRANSFORMATION** | every money column `Math.round(…)` → whole-rupee **summary** sheet; `Grand Total` is exact, Subtotal + GST reconcile to it; the exact-paisa figure lives on the invoice and in the GST report |
| Invoice list XLSX — cardinality | **MATCHES** | live: 296 filtered = 296 exported, 0 missing / 0 dup (§5) |
| Invoice list XLSX — special chars | **MATCHES** | comma / quote / newline / Unicode round-trip via SheetJS XML serialiser (no manual escaping); `writeSheet` refuses a column-shifted row |
| Bulk invoice XLSX (selection) | **MATCHES** | selection resolved against the full list, never `filtered` — a post-select filter change cannot drop a row |
| Job Card PDF | **INTENTIONAL TRANSFORMATION** | `Σ qty·rate`, no GST — a labour **estimate**, not a tax document (documented in the generator) |
| Purchase Order PDF — money | **MATCHES** | per-supplier subtotal + combined total; `money = "Rs " + Math.round(n)` (whole rupees — a PO is an order, not a receipt) |
| Purchase Order PDF — item name | **DEFECT → FIXED (PH22-04)** | same ellipsis-less `.slice(0, 52)`; now `truncW` |
| Customer Report (XLSX + PDF) | **MATCHES** | stored aggregates via `num()`; `exportReportPDF` shares the Excel `{head, rows}` array (`report-pdf-export.test.cjs`) |
| Vehicle Report "Revenue" (XLSX + PDF) | **DEFECT → FIXED (PH22-01)** | `revenueOf` → `invoiceTotals` was a simplified model; now the full model |
| Reports tab (Valuation / GST / Billing / …) | **MATCHES** | one `exportReportPDF`; `pdfTheme.cellText` does `₹`→`Rs.` once; `fitText` width-truncates cells with `…`; `writeSheet` date cells `t:'d'`, numbers stay numeric |
| QR payload | **INTENTIONAL TRANSFORMATION** | summary-only by design; `t = round(grand)`; identity params exact (§6) |
| `/verify` page | **INTENTIONAL TRANSFORMATION** | renders the URL params verbatim, **no Firestore lookup** — self-contained so a customer with no login (or no network) can still read it; disclaims "if this doesn't match your printed copy, contact the workshop" (§7) |
| Non-Latin text in any jsPDF output | **KNOWN LIMITATION (not a Phase 22 defect)** | jsPDF built-in Helvetica = WinAnsi; CJK / Devanagari / Arabic / `₹` have no glyph → garbled. Money path unaffected. Already worked around for `₹` (`"Rs. "`). See `KNOWN_LIMITATIONS.md`. |

---

## 4. The four defects

### PH22-01 — `invoiceTotals` was not the model it claimed to be  (MEDIUM)

`services/billingService.js`'s `invoiceTotals` docstring says *"exactly one definition
of the total"*, but the body was a **simplified subset** of
`BillingModule.totalsOf`:

- it ignored the **invoice-level discount** (`iv.discount` / `discountType`);
- it ignored **`gstMode`** — an `exempt` invoice still had GST summed, an `igst`
  invoice was treated as CGST+SGST;
- it had **no per-line-GST-absent → `iv.gstPct` fallback** (it read `l.gst` only).

`invoiceTotals` feeds `lib/vehicleStats.revenueOf`
(`invoicesOf(idx, v).filter(isRealized).reduce((s, iv) => s + invoiceTotals(iv).grand, 0)`),
which is the **"Revenue" column of the Vehicle Report** — an actual downloaded
XLSX / PDF — and every "Revenue" figure the Vehicles module shows. So for any
vehicle whose history contained a **discounted or GST-exempt** invoice, the exported
revenue was **larger than the sum of those invoices' own `grandTotal`s**.

Second effect: `invoiceStatus` / `isRealized` call `invoiceTotals`, so a discounted
invoice that was in fact fully paid could derive as "Partially Paid" here while the
Billing screen (`deriveStatus`) correctly showed "Paid" — an internal disagreement
between the two status derivations on exactly the invoices PH22-01 mishandled.

**Fix.** `invoiceTotals` body rewritten to mirror `totalsOf`'s full model
(line-disc → `sub` → `invDisc` → `afterDisc` → `anyLineGst` GST with the
`afterDisc/sub` ratio → `gstMode` override → `round`). `sub` / `gst` are still
returned whole-rupee (its consumers only read `.grand` / `.balance` / `.paid` /
`.parts` / `.labour`); `.grand` / `.balance` / `.paid` are now identical to the
oracle. `tests/financial-integrity.test.cjs` now runs its independent oracle against
**all three** money-path copies, not two.

### PH22-02 — a wrong-type field crashed PDF generation  (MEDIUM)

The PH21-D1 sweep hardened ~40 shared-calculator and always-mounted-consumer sites
with `lib/format.asArray`, but the **PDF generators** were not in that set. They
still did `iv.lines || []`, `iv.payments || []`, `jc.statusLog || []`,
`jc.complaints || []`, `jc.diagnosis || []`, `(cust.vehicles || [])`. A forged /
mis-migrated document with any of those as a **truthy non-array** → `.filter` /
`.find` / `.map` is not a function → the download handler throws and no PDF is
produced (the on-screen list already survives, post-PH21-D1).

**Fix.** `asArray` on every one of those reads in
`components/billing/BillingModule.jsx` (`drawInvoiceDocument`) and
`lib/workshopInvoicePdf.js`. Covered by `pdf-export-integrity.test.cjs` §10
(`lines: 'not-an-array'`, `payments: 'nope'`).

### PH22-03 — "Pending" vs "Unpaid"  (LOW)

`INVOICE_STATUS.PENDING` was the string `'Pending'`, returned by
`billingService.invoiceStatus` and `InventoryDashboard.invStatus`. **Every**
user-facing surface already said **"Unpaid"**: `BillingModule.deriveStatus` (the
Billing screen and its PDF/XLSX exports), the Billing status filter, the PDF
status-badge palette, `analyticsService`'s "awaiting payment" bucket,
`constants/ui.js`'s colour map. Net effect: the **same unpaid invoice** appeared as
**"Pending"** in the Reports → Billing export (driven by `invStatus`) and
**"Unpaid"** in the Billing list export (driven by `deriveStatus`).

**Fix.** One word — `INVOICE_STATUS.PENDING: 'Unpaid'` (key kept, so every
`INVOICE_STATUS.PENDING` reference is unchanged), and `invStatus`'s last line
`'Draft' : 'Pending'` → `'Draft' : 'Unpaid'`. `financial-integrity.test.cjs`'s two
"documented discrepancy" assertions flipped to assert agreement.

### PH22-04 — silent line-description truncation  (LOW)  *(found live)*

Creating a demo invoice with a deliberately long (166-char) part description and
printing it showed the customer-copy PDF cut it to `Front brake pad set OEM genuine
part with ceramic co` — a hard `String(l.desc || '-').slice(0, 52)` with **nothing**
to signal the cut. The **workshop copy** of the same invoice wraps the description
to two lines (`doc.splitTextToSize(...)`). Same authoritative text, two outputs, one
silently losing it — and two near-identical parts ("… (LEFT)" / "… (RIGHT)") could
truncate to the same string. The Purchase-Order PDF had the identical
`String(it.name).slice(0, 52)`.

There were **three** copies of "truncate to a pixel width with an ellipsis" in the
PDF layer: `pdfTheme.fitText` (private, report tables), `workshopInvoicePdf.truncW`
(private, identity fields) and — the one that mattered — the ellipsis-less
`.slice()`.

**Fix (CONSOLIDATE).** One exported `pdfTheme.truncW(doc, text, maxWidth)`
(binary-search to a width, trailing `…`, `String(x ?? '')` guard). `fitText` becomes
the report-cell flavour that applies `cellText` then delegates.
`workshopInvoicePdf.js` imports it and drops its private copy. The customer-copy
invoice PDF and the PO PDF now call `truncW(doc, …, <column width>)`. Net **−1**
truncation implementation. Live-verified: the same 166-char description now renders
as ~68 chars **ending in `…`**, width-fitted; money values unchanged.

---

## 5. CSV / Excel — cardinality

**There is no standalone CSV export** — the app deliberately emits real `.xlsx`
(column widths, `t:'d'` date cells, numeric cells so `=SUM()` works; the `exportCSV`
function name is legacy). So the check is *filtered Firestore rows == exported
rows*.

Live, demo mode, Billing list "Export":

```
Filter:            All Status / All Payments / All Time
Filtered invoices:  296   (list footer: "Showing 1–25 of 296")
Exported .xlsx:     297 rows  =  1 header + 296 data      (dimension ref="A1:N297")
Missing:             0
Duplicate:           0
```

Spot-check — INV-0171's exported row vs authoritative:
`Invoice INV-0171 · Date 2026-09-05 (serial 46270, cell type d) · Customer "Rohit
Chowdary" · Vehicle "Honda" · Subtotal 6134 · GST 1010 · Grand Total 7144 · Paid
7144 · Balance 0 · Profit 2530 · Status "Paid"`. Grand Total exact; the whole-rupee
`GST 1010` (vs 1009.80) is the intentional summary rounding — and 6134 + 1010 = 7144
reconciles to the Grand Total cleanly.

---

## 6. QR payload

`buildQrPayload` for INV-0171 →
`https://balaji-auto-os.vercel.app/verify?no=INV-0171&c=Rohit+Chowdary&v=Honda&d=2026-09-05&t=7144&s=Paid`

- `no` / `c` / `v` / `d` — identity carried **exactly** from the invoice.
- `t = Math.round(grand)` = **7144** — the authoritative amount (matches PDF Grand
  Total).
- `s` = the derived status.
- **Contains no** line items, payments, cost or profit — summary only, by design
  (`pdf-export-integrity.test.cjs` §6 asserts the absence).
- Origin: a `localhost` / private-IP runtime origin is **rejected** by `isPublic()`
  and the payload falls back to the production URL, so a PDF generated on any machine
  carries a scannable link. On the real deployment the runtime origin
  (`https://balaji-auto-os.vercel.app`) is used directly.
- Empty-state literals (`"undefined"` / `"null"` / `"NaN"`) are stripped; `""` when
  there is no document number (caller must then skip drawing).

---

## 7. `/verify` page

`pages/verify.js` builds its rows **purely from `router.query`** — **no Firestore
read**. This is intentional and documented in the page header: the customer scanning
the QR is typically not signed in, and the page must work even if the site is
unreachable from their phone; the URL itself is human-readable. It disclaims:
*"If anything here doesn't match your printed copy, please contact the workshop
before paying."*

Live, `/verify?no=INV-0171&c=Rohit+Chowdary&v=Honda&d=2026-09-05&t=7144&s=Paid`:

```
INVOICE NO.  INV-0171          DATE     2026-09-05
CUSTOMER     Rohit Chowdary    AMOUNT   ₹7,144.00      (₹ ok — real web font)
VEHICLE      Honda             STATUS   Paid
```

All six fields match the PDF and the authoritative invoice. With no params →
"nothing to verify" (0 rows, no crash). A tampered / SQL-ish / `<img>` id → shown as
literal text, no lookup, no crash, no wrong record.

---

## 8. Wrong-record / privacy

- **`pdf-export-integrity.test.cjs` §9:** render invoice A, assert A's PDF text
  contains A's customer / vehicle / part and **zero** of invoice B's name, vehicle,
  reg, part line or number.
- **`orphan-record-integrity.test.cjs`:** when the linked customer record is gone,
  the workshop PDF falls back to the invoice's **own denormalised** `iv.customer` /
  `iv.regNo` / `iv.phone` — never another customer's record. Regex there loosened to
  accept `asArray(cust.vehicles)` alongside `(cust.vehicles || [])`.
- The invoice XLSX exposes a **Profit** column — this is the shop owner's own export
  of their own data on their own screen; not a cross-tenant leak (single-shop app).
- The QR / `/verify` summary deliberately omits cost and profit.

---

## 9. Regeneration / staleness

- **Payment-state regeneration** (`§4`): the same invoice rendered before payment /
  after ₹4 000 / after final payment shows Balance = Grand → Balance = Grand−4000
  (status Partially Paid) → Balance = 0 (status Paid). The PDF is rebuilt from
  current `payments` every time — no snapshot.
- **Edit → regenerate** (`§5`): change lines + discount + `gstMode`, the new PDF
  shows the **new** grand total and not the old one; a GST-exempt edit removes the
  tax line entirely.
- Stored `iv.grandTotal` / `iv.balance` / `iv.status` are refreshed on save
  (`persistInvoice`) and on payment (`collectInvoicePayment`), and every generator
  recomputes from `lines` / `payments` anyway — a stale stored scalar cannot reach
  an export.

---

## 10. Unicode / long text  (live)

Demo invoice with customer
`Café Ravi & Sons "Spéçial" ₹<b>tag</b> — 日本語 مرحبا` and a 166-char line description
containing `<script>alert(1)</script>`:

- **No crash.** PDF generated, bounded.
- **Financial values exact** — numbers are ASCII, unaffected by the font.
- Latin-with-accents (`é ç ü î è`) **survive** in the PDF.
- `₹` → `¹`, `日本語` / `مرحبا` → mojibake — jsPDF falls back to UTF-16BE for a string
  with any non-WinAnsi character and the built-in font has no glyph. **Documented
  limitation, not a Phase 22 regression.**
- `<b>tag</b>` / `<script>…` render as **literal text** in the PDF and as **escaped
  text** on every screen and in the XLSX — no injection anywhere (React escaping;
  jsPDF draws strings literally; SheetJS XML-serialises).
- The em-dash `—` is dropped by WinAnsi (→ space). Minor, cosmetic, non-Latin.

---

## 11. Automated coverage added / changed

| File | Change |
|---|---|
| `tests/pdf-export-integrity.test.cjs` | **NEW** — 125 assertions. Independent invoice oracle; in-process PDF render + `(…) Tj` text extraction; three-way (oracle ↔ totalsOf ↔ invoiceTotals ↔ PDF) × 3 payment states; 60-line multi-page no-omit/no-dup; long-text / Unicode; payment-state + edit regeneration; QR payload; `/verify` row derivation; invoice XLSX values + cardinality + comma/quote/newline round-trip; wrong-record isolation; missing / orphan / wrong-type data; **§11 `truncW` (PH22-04)**. |
| `tests/financial-integrity.test.cjs` | Three-way now includes `billingService.invoiceTotals` vs the independent oracle (grand / paid / balance) + a "no NaN/Infinity in any of the three paths" guard; the two "Pending vs Unpaid" documented-discrepancy assertions flipped to `[FIXED, PH22-03]`. |
| `tests/orphan-record-integrity.test.cjs` | one brittle regex loosened for `asArray(cust.vehicles)`. |
| `tests/validation-bypass-integrity.test.cjs` | local `oracleStatus` `'Pending'` → `'Unpaid'` (PH22-03). |
| `tests/pdf-framework-consistency.test.cjs` | PO import assertion widened from an exact-line match to a token check (PH22-04 added `truncW`). |
| `tests/report-pdf-export.test.cjs` | `fitText` assertion updated for the `truncW` delegation (PH22-04). |

---

## 12. Gates

| Gate | Result |
|---|---|
| `npm test` | **143 / 143 test files** (`pdf-export-integrity.test.cjs` new, 125 assertions) |
| `npm run test:rules` | **2 / 2** (150 + 111) — **no `firestore.rules` change** |
| `npm run lint` | **0 errors** (pre-existing `<img>` warnings only) |
| `npm run build` | **✓ compiled successfully** |

---

## 13. Production code growth

`components/` `constants/` `lib/` `services/` — **+84 / −53** across 7 files
(`lib/workshopInvoicePdf.js` is net **−16**: private `truncW` deleted). The rest is
mostly comments — the PH22-01 model docstring, the `PENDING` rename rationale, the
shared `truncW` docstring. Logic added: one full-model calculation body (mirrors an
existing one), `asArray` swaps, one exported helper, one word. **No new file, no new
abstraction, no schema layer, no rules change.**

---

## 14. QA artifacts

- One demo invoice **INV-0297** created in the browser demo sandbox
  (`?demo=1`) to exercise Unicode + long-text + the PH22-04 fix. Demo data lives in
  the browser's local demo store (`maruti_demo` sessionStorage + demo-storage-local)
  — it **never touches production Firestore**, is isolated per browser, and is gone
  on the next demo reset. No production record was created, read for mutation, or
  modified.
- Read-only checks against the production `/verify` route logic only (no writes).
- No scratch files left in `tests/`.

---

## 15. Residual / documented, not fixed

- **Invoice list XLSX rounds money columns to whole rupees** — INTENTIONAL (a
  management summary; Grand Total is exact and the columns reconcile to it). The
  exact-paisa tax figure is on the invoice PDF and in the GST / GSTR-1 report.
- **Non-Latin text in any jsPDF output is garbled** — jsPDF built-in-font limitation,
  already in `KNOWN_LIMITATIONS.md`; the money and record-identity paths are
  unaffected, and `/verify` (a real web font) renders every script correctly.
- **`/verify` does not authenticate the data** — by design (works offline / logged
  out); mitigated by the on-page disclaimer. A signed `/verify` (HMAC in the QR) is a
  possible future hardening, noted in `ROADMAP.md`.
- **PH21-D2** (wrong-type nested *scalar* rendered as a React child) is unchanged —
  its complete fix is Firestore-rules type assertions (Phase 20's layer), still
  deferred.

---

## 16. Final assessment

Every export path was source-mapped and classified. The **primary invoice PDF, the
invoice XLSX, the QR payload and the `/verify` page match the authoritative data
exactly** — verified with independent hand-calculations and against real generated
bytes, automated and live. No export omitted, duplicated or misattributed a record.
Four defects — a derived-aggregate re-implementation that drifted from its own
contract (PH22-01), an un-guarded wrong-type field in the PDF path (PH22-02), a
one-word status-vocabulary split (PH22-03), and an ellipsis-less truncation
(PH22-04) — are fixed, with net-negative implementation count on two of them. Gates
green, no rules change, deployed.
