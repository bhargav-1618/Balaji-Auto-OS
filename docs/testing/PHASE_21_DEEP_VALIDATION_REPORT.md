# Phase 21 — Deep Adversarial Validation

**Purpose.** A second-level pass whose explicit goal was to **disprove** the original
Phase 21 conclusion — to find the gaps, the false confidence, and the cases where
malformed data is accepted by one path but breaks another.

**Outcome.** The original phase's **input**-surface conclusions all hold. Its
treatment of **forged / corrupt persisted documents** does not: a Firestore document
with a **wrong-type nested field** crashes the app app-wide, and the original
report's L-2 note ("neutralised in every read path") is false for that case. One
MEDIUM defect (**PH21-D1**) fixed at the shared-calculator + always-mounted-consumer
layer; one LOW (**PH21-D1b**, analytics NaN) fixed; two residuals documented
(**PH21-D2** wrong-type scalar rendered as a React child; **PH21-D3** a superseded
numbering fallback).

---

## 1. Previous Phase 21 conclusion (as written)

> "One confirmed defect — PH21-01 (HIGH) — found and fixed. **Everything else is
> SAFE / INTENTIONAL** (React's default escaping + CSP for HTML/script; consistent
> `String(x ?? '')` / `|| []` / `|| ''` guards; append-only ledgers;
> `billingService.toNum` finite-guards the money path; the Workshop PDF renders
> fully-malformed data without throwing)."

Its residual L-2:

> "an authenticated client can still forge a Firestore document with a
> NaN/Infinity/wrong-typed field directly … `num()` / `toNum()` neutralise it in
> every read path … an authorization concern already in Phase 19/20's scope, not an
> input surface."

---

## 2. Evidence-quality audit of the original Phase 21

| Original claim | Evidence it actually rested on | Grade |
|---|---|---|
| HTML/script is rendered, not executed | source-proof (no `dangerouslySetInnerHTML`/`innerHTML`/`eval`) + one PDF render + "no ∞/NaN on dashboard" | **strong** — now also **live-confirmed** (§10) |
| Unicode / emoji / RTL / zero-width round-trip | pure-function tests + PDF render | medium — now **live-confirmed** (§6) |
| Long strings safe | input `.slice()` caps + PDF `.slice(0,N)` | strong |
| Numeric (PH21-01) finite-guard | pure-model + emulator + faithful console replay | strong — **re-confirmed** |
| Negatives / decimals intentional | source + pure-model | strong |
| Missing / null fields safe | `\|\| []` / `\|\| ''` guards | **partial** — guards only null/undefined/`''`, NOT a wrong type (§5, §7) |
| Search safe | pure-function tests | strong |
| Analytics safe | pure-function tests with "evil parts" | **partial** — the "evil parts" test had a bug (`suppliers: 'not-an-array' ? [] : []` always `[]`), so wrong-type array fields were **never exercised** (§8) |
| PDF safe | in-process render from malformed data | strong — **re-confirmed** (§9) |
| Round-trip idempotent | pure-function `nonNegNum(nonNegNum(x))` only | **weak** — never run through a real save→reload→edit cycle (§4) |
| Import safe | own finite-guard `num()` | strong |
| **"Everything else SAFE"** | — | **BROKEN** — see §5 |
| L-2: "neutralised in every read path" | assertion, untested | **BROKEN** — a wrong-type array/object throws *before* any `num()`/`toNum()` runs (§5) |

**The gap that mattered:** the original `tests/malformed-input-integrity.test.cjs`
line was `suppliers: 'not-an-array' ? [] : []` — a JavaScript no-op (the ternary
always yields `[]`). So the one place the original phase intended to test a
wrong-type structural field, it did not.

---

## 3. Adversarial input matrix — was it actually tested in Phase 21?

| Category | Case | Phase 21 | This pass |
|---|---|---|---|
| **Text** | `""`, `" "`, `\t`, `\n`, 100/1k/10k chars, Unicode, JP/HI/AR, emoji, combining, zero-width, RTL, quotes, backslashes, HTML, script | ✅ pure-fn + PDF | ✅ **+ live** (§6, §10) |
| **Numeric** | 0, −1, 0.1/0.01/0.001, 999999999, 1e308, sci-notation, `"NaN"`, `"Infinity"`, `""`, whitespace, 309-digit | ✅ pure-fn + emulator | ✅ re-confirmed |
| **Identity** | dup phone/email/SKU/reg/ID, case/whitespace/normalization variants | ✅ Phase 18 + pure-fn | ✅ re-confirmed §13 |
| **Relationships** | missing / null / empty / invalid / deleted / wrong-entity id | ⚠️ "graceful fallback" claimed | ⚠️ **missing id = graceful; wrong-TYPE nested field = app crash** (§5) |
| **Wrong-type persisted field** (array→string/object/number/bool; scalar→object) | ❌ **not tested** (the `? [] : []` no-op) | ✅ **the headline finding** (§5) |

---

## 4. Round-trip corruption (Phase 21 §17 re-tested through a real save)

Demo mode, disposable customer `ZZ-QA-PH21D-RT`, name
`"  日本語 <b>x</b> 🚗 \t "`, notes = 9 000 chars incl. `<script>`:

| Step | Result |
|---|---|
| create via wizard → reload | name persisted as `"日本語 <b>x</b> 🚗"` (leading/trailing/`\t` **normalised away** by `sanitizeSingleLine` + `.trim()` — **intentional**, `<b>` kept as text); notes persisted verbatim, capped at 500 by the field (**intentional**, `maxLength`-equivalent `.slice(0,500)` on the textarea) |
| edit phone only → reload | name + notes **unchanged** — the `_rev`-guarded / field-diff save (Phase 12/13) touched only `phone` |
| edit name to Arabic + emoji → reload → edit again | exact round-trip, no character loss, no replacement chars, no precision issues |

**No unexplained truncation / normalization / type-flip.** The whitespace trim and
the 500-char notes cap are pre-existing intentional normalization, classified as
such. Phase 21's §17 conclusion (idempotent, no drift) **CONFIRMED** and now backed
by a real save cycle, not just pure-function idempotence.

---

## 5. Wrong-type persisted field → app-wide crash — **PH21-D1 (MEDIUM)**

### Reproduction (live, demo mode, before any fix)

A single forged **customer** document with `vehicles: "not-an-array"` (plus a
forged **invoice** with `lines: "not-an-array"` / `payments: "not-an-array"` and a
forged **job card** with `parts`/`labour` wrong-type), injected into demo storage:

```
┌─────────────────────────────────────────────┐
│  ⚠️  Something went wrong                     │
│  The app hit an unexpected error and stopped │
│                [ Reload app ]                │
│  (c.vehicles || []).forEach is not a function│
└─────────────────────────────────────────────┘
```

The **entire app** is down — no dashboard, no navigation. "Reload app" re-fetches
the same document and **re-crashes**. There is exactly **one** `<ErrorBoundary>`, at
`pages/_app.js` root — no per-module boundary. Recovery requires an admin removing
the offending document from the Firestore console.

### Why it happens

`x || []` was the intended "the field might be missing" guard. It does **not** catch
a field that is present but the wrong type:

| `x` | `x \|\| []` | `(x \|\| []).forEach` |
|---|---|---|
| `undefined` / `null` / `""` / `0` | `[]` | safe |
| `"oops"` / `{0:…}` / `42` / `true` | **the value itself** | **`TypeError` — throws** |

`invoice.lines`, `customer.vehicles`, `jobCard.parts` / `labour`, `part.suppliers`,
`po.items` are arrays **only by convention**. Firestore rules (Phase 20) type-check
**nothing** on the operational collections — an authenticated `signedIn` client can
write any shape. Emulator-confirmed for all 5 collections:

```
WROTE invoices/forge1       →  lines type = string
WROTE customers/forge1      →  vehicles type = string
WROTE jobCards/forge1       →  parts type = string
WROTE purchaseOrders/forge1 →  items type = string
WROTE parts/forge1          →  suppliers type = string
```

`onSnapshot` handlers do `snap.docs.map((d) => ({ id: d.id, ...d.data() }))` — **no
type normalization** — so the forged doc lands directly in React state and the first
calculator to touch it throws during render.

### Blast radius (before fix) — every crash was app-wide

| Path | Site |
|---|---|
| money engine (4 copies) | `billingService.invoiceTotals/revenueLines/partQuantities`, `InventoryDashboard.invTotals`, `BillingModule.totalsOf` — `lines.forEach` |
| dashboard alerts + sidebar badge | `analyticsService.computeAlerts` — `(c.vehicles \|\| []).forEach` |
| dashboard insights | `analyticsService.computeInsights` — `(iv.payments \|\| []).filter`, `(p.suppliers \|\| []).forEach` |
| dashboard onboarding | `analyticsService.computeAchievements` — `suppliers.some` |
| reservations / job-card save | `inventoryService.cardReservedQtys` — `(card.parts \|\| []).forEach` |
| sidebar reminder count | `customerService.countCustomerReminders` — `(c.vehicles \|\| []).forEach` |
| Reports (Vehicles/Technician/Top-Parts/Billing rows) | `vehicleService.topVehicleBrands`, `InventoryDashboard` ReportsView memos |
| command palette (always mounted) | `InventoryDashboard` `customerIndex` — `(c.vehicles \|\| []).flatMap` |
| every secondary module | each of JobCards / Customers / Vehicles / PurchaseOrders / Reminders has its **own** local `useSearchIndex` / KPI code with the same idiom |

### Fix — `lib/format.asArray`, consolidating the codebase's own pattern

`components/vehicles/VehiclesModule.jsx` **already** did the right thing locally:

> "…coerce the known collections to arrays … This is done ONCE at the edges (wizard
> init, list mapping) so the UI can use the values directly and safely."
> `const asArray = (v) => (Array.isArray(v) ? v : []);`

Lifted that to `lib/format.js` (a pure, zero-dependency leaf) and routed every
**shared calculator** and every **always-mounted / list-level consumer** through it:

| File | Sites |
|---|---|
| `lib/format.js` | new `asArray` (1 line) |
| `services/billingService.js` | `invoiceTotals` `lines`, `partQuantities`, `revenueLines` |
| `services/analyticsService.js` | `computeAlerts` vehicles; `computeInsights` payments + suppliers; `computeAchievements` suppliers; **`qtyOf` ×2 coerce (PH21-D1b)** |
| `services/inventoryService.js` | `cardReservedQtys` parts |
| `services/customerService.js` | `countCustomerReminders` customers + vehicles |
| `services/vehicleService.js` | `topVehicleBrands` customers + vehicles |
| `components/InventoryDashboard.js` | `invTotals` lines; OverviewView `p.suppliers` ×2; `customerIndex`/`supplierIndex`; command-palette `regs`; ReportsView `topParts`/`billingRows`/`vehicleRows`/`technicianPerf` |
| `components/billing/BillingModule.jsx` | `totalsOf` lines; list `payModeF`; billing-insights `modeSplit` + `partMap` |
| `components/jobcards/JobCardModule.jsx` | customer search index ×2; `statusLog` filter; reg-dup `elsewhere` |
| `components/customers/CustomersModule.jsx` | wizard reg/vin owner memos ×2; customer search index ×2 |
| `components/vehicles/VehiclesModule.jsx` | `asArray` local → shared import; owner search index; vehicle-list builder; JC-mini-list `complaints` |
| `components/inventory/InventoryPurchaseOrders.jsx` | PO search index ×2; PO-items list render |
| `components/reminders/RemindersModule.jsx` | `c.vehicles` reminder loop |

`asArray(x)` is **semantically identical** to `x || []` for every real value (array
or nullish); it only diverges on a wrong type, coercing it to `[]` instead of
throwing.

### Verification (live, after fix)

All 8 primary tabs **+ the command palette** load and navigate cleanly with the
forged invoice / customer / job-card documents present:

```
{ overview: ok, billing: ok, reports: ok, jobcards: ok,
  customers: ok, vehicles: ok, inventory: ok, suppliers: ok,
  _forgedRowsPresent: 3, _xss: false }
```

### Severity: MEDIUM

*Impact* touches CRITICAL wording ("repeatable app-wide crash"), but: requires an
**authenticated** write (single-shop trust model) or a bad migration; **no data is
lost or corrupted** (the forged doc is visible and deletable, all real records
intact); a defined recovery exists. The always-on surfaces (dashboard, command
palette, every money calculation) are now immune; see §16 for the residual.

---

## 6. Unicode / emoji / international text (live)

Customer `名 = "<img src=x onerror=…> \"Robert'); DROP TABLE--\" 山田 🚗 ‮ RTL"`,
notes 9 000 chars + `<script>`:

* list, search, and detail render the name as **literal text** (accessibility tree
  shows the raw `<img …>` string), `window.__XSS_FIRED` **never fired**
* RTL override, zero-width, emoji, Devanagari all display; no replacement chars
* search located the record by the `山田` fragment

**CONFIRMED SAFE.**

---

## 7. Wrong-type testing (Phase 21 §7)

105 calls — `lines` / `payments` / `vehicles` / `parts` / `labour` / `suppliers` /
`history` / `noteEntries` each set to `'x'` / `{0:…}` / `42` / `true` / `null` /
`undefined` / `''` / `NaN` — through **every** shared calculator:

* **before fix:** 27 crashes
* **after fix:** **0 crashes**, every result finite / well-formed

---

## 8. Analytics adversarial (Phase 21 §9)

* **PH21-D1b (LOW, fixed):** `computeWorkshopScore` returned `{ score: NaN }` when a
  sales row had `qty: "abc"` — `qtyOf = s.qty ?? s.quantity ?? 0` (nullish
  coalescing does **not** catch a string) then `recentSales += "abc"` string-concat
  → the dashboard **Workshop Score tile rendered "NaN/100"**. Fixed:
  `qtyOf = (s) => { const n = Number(s.qty ?? s.quantity ?? 0); return Number.isFinite(n) ? n : 0; }`
  (both copies — `computeWorkshopScore`, `computeInsights`).
* `computeInventoryHealth`, `computeWorkshopProgress`, `computeAlerts`,
  `computeInsights` on "evil" inventory + sales (`stock:'1e308'`, `sellingPrice:'abc'`,
  `createdAt:'not-a-date'`, wrong-type arrays) → all finite, all well-formed after
  the §5 fix.
* No `NaN` / `Infinity` / `undefined` / `null` reaches rendered analytics output.

---

## 9. PDF / print adversarial (Phase 21 §10 re-confirmed)

`renderWorkshopInvoicePdf` re-run in-process from a fully-malformed invoice
(400-char JP + `<script>` + emoji + zero-width in every text field;
`qty:'9'.repeat(400)`, `rate: Infinity`, `totals` all `NaN`) → **2-page PDF, no
throw, no infinite loop, no raw executable content.** `num()`'s PH21-01 finite-guard
still holds. **CONFIRMED.**

---

## 10. XSS / unsafe-rendering (Phase 21 §11 re-confirmed live)

`<script>`, `<img src=x onerror=…>`, `javascript:` stored in customer name / notes,
opened in list + detail + search: rendered as **text**, `window.__XSS_FIRED`
**false** throughout, `read_console_messages` clean. React escapes every string
child; CSP (`object-src 'none'`, no prod `unsafe-eval`) is a second layer.
**CONFIRMED SAFE.**

---

## 11. Direct malformed-document testing (Phase 21 §6)

Emulator + demo injection covering wrong-type `name` / `phone` / `vehicles` /
`lines` / `payments` / `items` / `stock` / `suppliers` (null, string, number,
object, boolean). Firestore accepts every shape (only `undefined` is rejected at
write). **Consumer safety** is the finding — see §5 (arrays, fixed) and §16 (scalars
rendered as React children, documented).

---

## 12. Firestore persistence

Every wrong-type value written was either **SAFELY PERSISTED** (Firestore stores any
shape) or **REJECTED BEFORE WRITE** (`undefined` only). No partially-persisted,
silently-truncated, or type-corrupted state. Confirmed by inspecting the emulator
documents.

---

## 13. Duplicate / normalization adversarial (Phase 21 §13)

Re-confirmed unchanged from Phase 18: `phoneKey` (digits only), `regKey` (upper +
strip `[\s\-/]`), `normId` (trim + lower + strip ws), `safeLower` — `ABC123` /
`abc123` / `" ABC123 "` collide; `9586668406` / `+919586668406` / `958-666-8406`
normalize to the same key. No "main form rejects, quick-create accepts" gap found
(PH18-01 already closed the one that existed).

---

## 14. Import adversarial (Phase 21 §14)

Re-confirmed: the CSV/XLSX importer's own `num()` is finite-guarded
(`Number.isFinite(n) && n >= 0 ? n : 0`); rows are validated before write; invalid
rows skipped, valid rows continue (non-atomic, chunked at 450, `rejected[]`
surfaced). `suppliers`/`categories` are always built as arrays. Unchanged.

---

## 15. Edit-after-malformed (Phase 21 §15)

Demo: forged customer (wrong-type `history`), edit `phone` via the wizard, reload —
`history` field **unchanged** (the Phase 12/13 field-diff save writes only the keys
that changed; it does not re-serialize the whole document). No overwrite / null /
convert / drop of the malformed field. **CONFIRMED.**

---

## 16. Cross-workflow (Phase 21 §16)

Customer → Job Card → Invoice → Payment and Part → PO → Stock → Invoice → Sales
walked with unusual (long / Unicode / emoji) display values — relationships hold,
no calc breaks. (Wrong-**type** structural fields are §5, not display values.)

---

## 17. Refresh / retry (Phase 21 §17)

No malformed state appeared from a stale-client retry (durable-opId architecture is
connectivity-agnostic — Phase 5/6). A forged doc is re-fetched identically on
reload; post-§5-fix that is now harmless on the always-on surfaces.

---

## 18. Live website deep check

| # | Check | Result |
|---|---|---|
| 1 | Unicode customer displays | ✅ |
| 2 | emoji customer displays | ✅ |
| 3 | long (9k) customer name/notes | ✅ (notes capped 500 by design) |
| 4 | HTML/script-like note rendered safely | ✅ text, no execution |
| 5 | unusual numeric input (PH21-01) | ✅ finite |
| 6 | search unusual text | ✅ found by fragment |
| 7 | filter unusual record | ✅ |
| 8 | PDF/print | ✅ (in-process render) |
| 9 | reports/analytics | ✅ finite, no NaN |
| 10 | **forged wrong-type doc, all 8 tabs + palette** | ✅ **survive (post-fix)** — crashed pre-fix |

Production Firestore **unchanged** — all forge/injection was demo-storage + emulator
(`demo-rules-test`) only. QA rows removed (§21).

---

## 19. Gaps discovered vs the original Phase 21

1. **The wrong-type structural-field case was never actually tested** (the
   `? [] : []` no-op). This is the whole of §5.
2. The original **L-2** understated the impact: not "neutralised in every read
   path" but "throws before any coercion runs, app-wide."
3. **Round-trip** was pure-function idempotence only; now backed by a real
   save→reload→edit cycle (§4 — confirms the original conclusion).
4. **Live** evidence for Unicode/emoji/XSS was thin (one dashboard screenshot); now
   exercised through real list/detail/search interactions.
5. **`computeWorkshopScore` NaN** (D1b) — the original report *mentioned* this class
   as INFO and chose not to fix; §9's "search for NaN in rendered output" made it a
   finding.

---

## 20. Confirmed defects (this pass)

| ID | Severity | Summary | Status |
|---|---|---|---|
| **PH21-D1** | **MEDIUM** | wrong-type nested **array** field (`lines`/`vehicles`/`parts`/`labour`/`suppliers`/`items` as a truthy non-array) → `TypeError` in a calculator → app-wide ErrorBoundary crash, "Reload" re-crashes | **fixed** — `lib/format.asArray` at the shared calculators + every always-mounted consumer; all 8 tabs + palette verified |
| **PH21-D1b** | **LOW** | forged/legacy sales row `qty:"abc"` → `computeWorkshopScore` returns `{score: NaN}` → dashboard "NaN/100" | **fixed** — `qtyOf` coerces via `Number()` + `Number.isFinite` |
| **PH21-D2** | **MEDIUM** | wrong-type nested **scalar** rendered as a React child (`vehicle.regNo = {}`) → "Objects are not valid as a React child" → app-wide crash | **documented** (§16) — no code change |
| **PH21-D3** | **INFO** | forged 22-digit `invNo` → `billingService.nextDocNumber` (dead) / `BillingModule.invSeqMax` (DRF-drafts + `seedFrom` only) → `"INV-1e+22"` | **documented** — Phase 2 `counters` transaction is the real GST-serial allocator; not fixed |

---

## 21. Root causes

1. **`x || []` is not a type guard.** It reads as "handle a missing array" but only
   catches falsy values; a truthy non-array passes straight through to `.forEach` /
   `.map` / `.flatMap`. Used ~50× across the calculators and every module's local
   search-index code.
2. **No type normalization at ingestion.** `onSnapshot` → `snap.docs.map(d =>
   ({...d.data()}))` puts whatever shape Firestore holds directly into React state.
3. **Firestore rules type-check nothing** on the operational collections (Phase 20),
   so `signedIn` write access = arbitrary document shape.
4. **One app-level ErrorBoundary**, so any render throw is total, and "Reload"
   re-fetches the same bad document.
5. **`?? ` vs coercion** — `s.qty ?? s.quantity ?? 0` treats a string `qty` as
   present, then `+` concatenates (D1b).

---

## 22. Fixes

See §5 (table of 13 files) and §8. Net: one 1-line shared helper (`asArray`,
consolidating VehiclesModule's own `normalizeVehicle` pattern), one 1-line coercion
change in two `qtyOf` copies, and ~40 call sites changed from `(x || []).method` to
`asArray(x).method` (semantically identical for real data). **No new abstraction, no
schema layer, no Firestore-rules change.**

---

## 23. Final conclusion

### Original Phase 21 claims, classified

| Claim | Verdict |
|---|---|
| PH21-01 (numeric Infinity/NaN at the write boundary) fixed | **CONFIRMED** — re-verified pure-model + live |
| HTML / script-like input rendered, not executed | **CONFIRMED** — now live |
| Unicode / emoji / RTL / zero-width round-trip | **CONFIRMED** — now live |
| Long strings safe | **CONFIRMED** |
| Negative numbers / decimals intentional | **CONFIRMED** |
| Duplicate-value semantics (Phase 18) | **CONFIRMED** |
| Search robust (pure substring/token, no user RegExp) | **CONFIRMED** |
| PDF renders malformed data without throwing | **CONFIRMED** — re-rendered |
| Import safe (own finite-guard, skip-invalid-continue) | **CONFIRMED** |
| Round-trip idempotent / no drift | **CONFIRMED** — now through a real save cycle |
| Demo / prod parity | **CONFIRMED** |
| Missing / null fields safe | **PARTIALLY CONFIRMED** — `\|\| []` handles null/undefined/`''`; a wrong **type** was not covered |
| Relationship corruption safe | **PARTIALLY CONFIRMED** — missing/invalid id degrades gracefully; wrong-type nested field crashed the app |
| Analytics safe | **PARTIALLY CONFIRMED** — finite-guarded for numbers; wrong-type array crashed `computeAlerts`/`computeInsights` (fixed); D1b NaN (fixed) |
| **"Everything else is SAFE / INTENTIONAL"** | **BROKEN** — disproven by PH21-D1 / D2 |
| L-2: "neutralised in every read path" | **BROKEN** — a wrong-type array/object throws before any coercion; corrected here to a MEDIUM limitation with a fix |

### Is Phase 21 genuinely validated?

**The input-surface half: yes** — forms, paste, keyboard, CSV import, search, PDF,
analytics numeric paths, and the PH21-01 fix all hold under adversarial re-testing,
now with live-browser evidence the original lacked.

**The persisted-document half: no, as originally written** — and this pass fixed the
tractable part (wrong-type **arrays** can no longer crash the always-on surfaces or
any money calculation) and documented the rest (§16: wrong-type **scalars** rendered
as React children; the complete fix is Firestore-rules type assertions —
`request.resource.data.lines is list` — the layer Phase 20 established as
authoritative and which currently asserts nothing, deferred because it needs a rules
deployment, does not cover legacy/bug-introduced data, and is a focused task of its
own).

**Net:** Phase 21's headline (malformed *input* is contained) stands. Its blanket
"everything else is safe" did not survive contact with a forged document.

---

## Regression gates

| Gate | Result |
|---|---|
| `npm test` | **142 / 142 test files** (`tests/malformed-input-integrity.test.cjs` §10 added — 238 assertions), 0 failed |
| `npm run test:rules` | **2 / 2 files, 261 assertions** (150 + 111), 0 failed — no rules change |
| `npm run lint` | 0 errors (pre-existing warnings only) |
| `npm run build` | ✓ Compiled successfully |

## QA cleanup

All `ZZ-QA-PH21D*` disposable rows removed from demo storage (invoices / customers /
job-cards); emulator probe scripts (`tests/rules/_tmp/`) removed; production
Firestore never touched. `git status` clean apart from the files listed in §5/§22
plus this report and the extended `tests/malformed-input-integrity.test.cjs`
(section 10).

## Code-growth review

```
New production files:       0
New abstractions:           1  (lib/format.asArray — 1 line, consolidating VehiclesModule's existing local copy)
Net distinct idioms:        one shared `asArray` replaces ~40 `(x || []).method` + 1 local `asArray`
Significant new logic:      none — `asArray(x)` ≡ `x || []` for every real (array | nullish) value
Why existing couldn't handle it: `x || []` does not catch a truthy non-array; VehiclesModule already
                            proved the fix locally (`normalizeVehicle`) — this lifts it to the shared layer
```
