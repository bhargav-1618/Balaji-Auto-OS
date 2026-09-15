# Phase 23 — Deep Adversarial Re-Audit, Round 3

**Purpose.** A fourth pass. Do not trust the DEEP-2 CONDITIONAL PASS. Audit the
KPI/analytics families that had **not** received the same depth of scrutiny as
Revenue / Cost / Profit / Margin / Outstanding — Customer, Vehicle, Workshop, Parts
Profitability, Inventory Valuation, Capital / Dead-Stock, GST, counts, trend — and
find another

> source correct → intermediate transformation/predicate wrong → plausible number → wrong business meaning

defect, of exactly the kind PH23-01, PH23-D1, PH23-D2 already were.

**Outcome — one new MEDIUM defect (`PH23-D3`), fixed.**

| ID | Sev | One-line |
|---|---|---|
| **PH23-D3** | MEDIUM | The invoice realization moves `part.stock` but **never touched `part.salesCount`** — so `salesCount` is a **Quick-Sell-only** counter, not "total units sold". The **Dead Stock**, **Total Dead Capital** and **Fast Mover** analytics classify parts on `salesCount === 0`, so **every part that only ever sells through invoices** (the normal billing flow) was flagged as **"never-sold" dead capital**. In the demo, a clutch plate with **15 units / ₹39,508 of real ledger sales** was the **#1 entry on the Dead Stock list** and half the "Dead Capital" figure. |

PH23-01, PH23-D1, PH23-D2 all **re-confirmed** (see §2). Mutation testing extended to
**19 / 19** corruptions caught. No `firestore.rules` change. `npm test` 144/144,
`npm run test:rules` 2/2, lint 0, build ✓. PH23-D3 fix **live-verified** in demo mode
(seed reconciliation **and** the runtime path).

**FINAL CLASSIFICATION: CONDITIONAL PASS** — the analytics *math and semantics* are
now independently verified across every KPI family; PH23-D3 is fixed with an
independent oracle + live check; the one remaining condition on an unqualified PASS is
that **authenticated production reconciliation was not performed** (tooling limitation
— no authenticated production session available).

---

## 1. KPI/analytics families audited this round

| Family | Source | Verdict |
|---|---|---|
| **Parts profitability** (Top Profitable Parts, revenue/profit/margin per part, Vehicle Analytics rev/prof) | `ledgerByPart` = Σ `sales.revenue` / `.cost` / `.profit` per `partId` (frozen ledger) | **MATCHES** — DEEP-1/2 already hardened the `sales` ledger; per-part aggregation reads the frozen rows |
| **Dead Stock / Dead Capital / Fast Mover** (classification) | `p.salesCount` | **BROKEN → PH23-D3** — `salesCount` was Quick-Sell-only |
| **Inventory valuation** (`lockedCapital` = `purchasePrice × stock`; `expectedProfit` = `(sellingPrice − purchasePrice) × stock`) | `parts` catalog | **MATCHES** — a potential/valuation metric, correctly labelled ("Purchase × stock on hand", "(MRP − purchase) × stock"); not a realized figure |
| **Slow-moving stock insight** (`computeInsights` "N in-stock parts had no sale in 30 days") | the **`sales` ledger** (`soldRecentIds` from `sales`) | **MATCHES** — and notably, this one **already uses the ledger**, confirming `salesCount` was the odd one out |
| **Vehicle analytics** (`revenueOf`, `computeVehicleStats`) | `Σ invoiceTotals(iv).grand` for `isRealized` only | **MATCHES** — `isRealized`-gated (drafts/estimates/cancelled/refunded excluded); GST-inclusive per-vehicle turnover (intentional, DEEP-1 §17). `computeVehicleStats` has no profit/margin. |
| **Customer analytics** (`totalSpent`, `outstanding`, `countCustomerReminders`) | `syncCustomerTotals` → `isRealized` / `isOutstanding` gates (PH23-D2) | **MATCHES** (post-PH23-D2) |
| **Workshop Score / Progress** (`computeWorkshopScore`, `computeWorkshopProgress`) | live inventory + ledger + suppliers; `qtyOf` coerces (PH21-D1b) | **MATCHES** — `computeWorkshopProgress` billing section uses the correct `['Unpaid','Partially Paid']` / `!'Draft'` predicate |
| **GST / tax KPIs** ("GST Collected", GST report) | `Σ totalsOf(iv).gst` over real bills (PH23-D2 loop) | **MATCHES** — separate from the profit chain; GST is structurally absent from analytics revenue/cost/profit |
| **Payment / collection KPIs** ("₹X collected today", payment mode split) | `payments[]` (`p.date === today`, `p.mode`) | **MATCHES** — cash-based, labelled as such; mode split now over real bills (PH23-D2) |
| **Counts** (invoice count, sales count, `draftCount`, `pendingCount`, `realCount`, Today's Invoices) | derived per-invoice/row | **MATCHES** (post-PH23-D2 — `pendingCount` and the money loop count only real bills) |
| **Average invoice** | `grand / realCount` (PH23-D2) | **MATCHES** (post-PH23-D2) |
| **Trend** (Monthly Profit Trend, 14-day revenue sparkline) | `salesRollups` (fallback: `sales` ledger); Billing trend = `Σ totalsOf().grand` for real bills | **MATCHES** — `rollup.profit == rollup.revenue − rollup.cost` by construction; Billing trend `isReal`-gated (PH23-D2) |
| **`isExpiring`** (Insurance/PUC/Warranty expiring counts) | `daysUntil(iso) <= windowDays` — **no lower bound** | **INTENTIONAL** — a lapsed document *should* appear in a renewal reminder; `computeAlerts` agrees (flags "expired N days ago" as Critical). The `vehicleStats.js` code comment ("not already long gone") overstates it; comment is imprecise, behaviour is defensible. Not changed. |

## 2. PH23-01 / D1 / D2 re-confirmation

| | Result |
|---|---|
| **PH23-01** (invoice-level discount → ledger via `afterDisc/sub`) | **CONFIRMED** — 7 adversarial rounding cases, worst drift `8.5 × 10⁻¹⁴` |
| **PH23-D1** (analytics COGS = the invoice line's `purchasePrice` snapshot) | **CONFIRMED** — shipped-code reproduction with source guards; legacy fallback intact; `Σ ledger COGS == totalsOf().profit`-derived |
| **PH23-D2** (Outstanding / Pending / Total Spent count only real receivables via `isOutstanding`) | **CONFIRMED** — `§16` reproduces the shipped `syncCustomerTotals` + `stats` loop verbatim against a hand oracle |

## 3. PH23-D3 — the hunt

`part.salesCount` write sites (grep):

| Path | Touches `salesCount`? |
|---|---|
| `runQuickSaleTx` (Quick Sell — counter sale) | ✅ `salesCount: increment(want)`, in the SAME `tx.update` as `stock` |
| Quick Sell local mirror + pendingSales reconciliation | ✅ |
| **`applyRealizationPlanInTx`** (invoice realization — the primary sales flow) | ❌ **only `stock: increment(delta)`** |
| `applyPlanToLocalInventory` (prod local mirror) | ❌ only `stock` |
| `applyStockDelta` (demo invoice realization — its only caller) | ❌ only `stock` |
| Part create / edit | sets to 0 / carries (correct — PH12-01) |

**So `salesCount` counts Quick-Sell units only.** In a shop that bills through
invoices (parts fitted during a service go on the job-card invoice — the normal
flow), a part sold hundreds of times on invoices sits at `salesCount === 0`.

Readers that then misinterpret `salesCount === 0` as "never sold":

| Reader | Displayed as |
|---|---|
| `AnalyticsView.kpi.deadCapital` (line ~4400) | **"Total Dead Capital"** card, `hint: 'Locked in never-sold items'` |
| `isDeadStock(p)` (line ~437), `deadStockReason` → "**No sales recorded**" | Dead Stock leaderboard + **XLSX export** + part-row badge |
| `isFastMover(p)` = `salesCount >= FAST_MOVER_MIN` (`inventoryService`) | the "**Fast**" badge (never earned by invoice-only parts) |
| `byPopularity` sort | leaderboard ordering |

And — the tell that it's an oversight — **`computeInsights` "slow-moving stock" already uses the `sales` ledger** (`soldRecentIds` from `sales`), not `salesCount`. The app knew the ledger was the right source in one place and forgot it in the classification.

## 4. PH23-D3 — evidence

### Live (demo mode, dev server)

Demo part `demo-part-83` **"Maruti Dzire Clutch Plate"**:

| | BEFORE the fix | AFTER the fix |
|---|---|---|
| `salesCount` field | **0** | **15** (== ledger units) |
| ledger sales | 6 rows, **14 units**, **₹39,508** | (regenerated: 15 units) |
| On the Analytics **Dead Stock** list | **#1 entry** — "24 units · ₹54,024 locked · 157 days · No sales recorded" | **absent** |
| **Total Dead Capital** KPI | **₹1,06,206** | **₹19,638** (−82 %) |
| Dead Stock list #1 | the clutch plate | **"Toyota Glanza Engine Oil 5W-30"** — verified `salesCount 0` **and** `ledgerUnits 0` (a genuinely never-sold part) |
| Demo parts with ledger sales but `salesCount 0` | 1 | **0** |

### Live runtime path

Created invoice **INV-0297**, 4 units of "Engine Oil 5W-30" (`demo-part-172`), paid:

| | before | after |
|---|---|---|
| `stock` | 37 | **33** (−4) |
| `salesCount` | 4 | **8** (+4) |

**`salesCount` now moves with `stock` on every invoice sale.**

## 5. PH23-D3 — root cause & fix

**Root cause.** `salesCount` and `stock` are siblings — Quick Sell updates both in one
`tx.update`. The invoice realization (a later, separate code path — `planInvoice
realization` / `applyRealizationPlanInTx`) updates `stock` and forgot `salesCount`. A
**missing field in the sibling write**, exactly like PH23-D1 (`invoiceRevenueLines`
carried `qty`/`revenue` but not `cost`).

**Fix (REUSE — no new counter, no new abstraction, no reader changes):** add
`salesCount` to the 3 invoice-realization stock-write sites, symmetric with `stock`.
The plan's `stockDeltas[partId]` is **negative** when parts leave the shelf on a sale,
so `-delta` is the units sold; a reversal (`delta` positive) unwinds it — identical to
how `stock` is handled, and idempotent (a re-run with no change → delta 0 → no move).

1. `applyRealizationPlanInTx` — `{ stock: increment(delta), salesCount: increment(-delta), … }`
2. `applyPlanToLocalInventory` (prod local mirror) — `salesCount: (p.salesCount || 0) - plan.stockDeltas[p.id]`
3. `applyStockDelta` (demo realization) — `salesCount: (p.salesCount || 0) - deltaMap[p.id]`

Plus:
4. `lib/demoData.js` — after the ledger is derived from invoices, reconcile every
   part's `salesCount` to `Σ ledger units` (the seed used a random `between(0,120)`,
   decorrelated from the sales the demo shows).
5. `DEMO_SCHEMA` bumped `v4-jobcard-real-statuses` → `v5-salescount-from-ledger` so
   existing demo sessions re-seed with the reconciled `salesCount`.

**Not retroactive for production** — like PH23-01/D1/D2, an increment-based counter;
parts invoice-sold before this fix keep their under-count and self-heal from the next
sale. No migration was run.

## 6. Independent oracle & mutation testing

`tests/analytics-integrity.test.cjs` §17 (new, 125 → 141 assertions):

- source guards on all 3 write sites + the (unchanged) Quick Sell site
- a functional reproduction of the `salesCount` move: a part sold 14 units on invoices
  → `salesCount 14`; reverse 3 → `salesCount 11` (symmetric with `stock`)
- **`isFastMover`** (imported from `inventoryService`) now decides on real sales
- **demo dataset**: EVERY part's `salesCount === Σ ledger units` (0 mismatches); no
  part with real ledger sales left at `salesCount 0`
- 3 mutations (stayed at 0 / +1 / doubled) — all caught

**Mutation testing total across DEEP-1/2/3: 19 / 19 corruptions detected.**

## 7. Regression gates

| Gate | Result |
|---|---|
| `npm test` | **144 / 144 test files** (`analytics-integrity.test.cjs` 141 assertions) |
| `npm run test:rules` | **2 / 2** (150 + 111) — no `firestore.rules` change |
| `npm run lint` | **0 errors** |
| `npm run build` | **✓ compiled successfully** |

2 brittle source-pattern assertions updated (`inventory-accounting-integrity` for the
added `salesCount: increment(-delta)`; `jobcard-advisor-kpi-review` for the
`DEMO_SCHEMA` bump — that test exists precisely to enforce the bump).

## 8. Code-growth review

```
Production lines added:   ~28   (components/InventoryDashboard.js +17, lib/demoData.js +11)
Production lines removed:   ~4
Net production change:     +24   (~18 comment)
New production functions:    0
New production files:        0
New abstractions:            0
Existing mechanisms reused:  `stock`'s own diff-based increment pattern (salesCount is
                             its sibling); the DEMO_SCHEMA cache-bust; the ledger-as-
                             source-of-truth convention demoData.js already states.
Test lines added:          ~40   (analytics-integrity.test.cjs §17)
Documentation lines added: ~230  (this report + ROADMAP + KNOWN_LIMITATIONS)
```

## 9. QA cleanup

- Live validation created demo invoices in the browser demo sandbox (never production
  Firestore); all demo storage wiped and re-seeded pristine (verified — `salesCount`
  reconciliation confirmed, 0 mismatches, `DEMO_SCHEMA v5`).
- `.next/` rebuilt clean after a `npm run build` clobbered the running dev server's
  chunks (dev restarted; not a code issue).
- Scratch probes deleted. No debug logging, no `.skip`/`.only`, no secrets.
- Dev server + emulator stopped.

## 10. Remaining limitations

- **`salesCount` can transiently go negative in production** if a pre-fix invoice sale
  (never counted) is later reversed. The readers all treat `< 0` the same as "has sold"
  (`(x || 0) === 0` is false; `>= min` is false), i.e. the safe interpretation; it
  self-heals on the next sale. Consistent with how `stock` is allowed to go negative.
- `billingService.revenueLines` / `ledgerDelta` — exported, tested, still not wired
  into production (ROADMAP "Code health").
- Rollup month key = client `new Date()` at plan time vs sales `serverTimestamp()` —
  theoretical month-boundary split (DEEP-2 §3). INFO.
- `custom` date-range start could shift one day for a timezone behind UTC. INFO.
- Historical `sales` rows / rollups / `salesCount` not retroactively corrected by
  PH23-01/D1/D2/D3 (increment-based; no migration).
- **Authenticated production reconciliation not performed** — no authenticated
  production browser session (tooling limitation, not an app issue).
- PH21-D2 (wrong-type nested scalar as a React child) — unchanged, deferred.

## 11. Final classification

**CONDITIONAL PASS.**

Four rounds of adversarial re-audit have now traced every material analytics/KPI path
— Revenue, Cost, Gross Profit, Margin, Outstanding, Total Spent, Dead Stock, Dead
Capital, Fast Mover, Vehicle revenue, Workshop scores, GST, collection, counts, trend
— to its authoritative business source, and found (and fixed) four defects of the same
class: **PH23-01** (invoice discount missing from the ledger), **PH23-D1** (analytics
COGS from the live catalogue, not the line snapshot), **PH23-D2** (drafts/estimates
counted as receivables), **PH23-D3** (`salesCount` a Quick-Sell-only counter, so
invoice-sold bestsellers flagged as dead capital). Each was: correct source → an
intermediate calculation/predicate/field silently changing the meaning → a plausible
number → the wrong business decision.

Every invariant is now independently supported by source trace + hand oracle +
mutation test (19/19) + demo-mode live verification. The single condition on an
unqualified PASS is an **authenticated-production read-only spot-check**, which was
attempted this session and **BLOCKED** by the environment's network-egress policy and
the absence of any authenticated-production browser surface (see the section below).

**Phase 23 is closed at CONDITIONAL PASS.** DEEP-4 is **not** recommended — the
defect-class surface is exhausted and another code pass cannot substitute for a
production reconciliation. No further analytics code changes without a new concrete
defect. The BATCH 1–6 read-only checklist remains available to the user; running it
later can lift this to PASS without reopening the audit.

```
PHASE 23 DEEP RE-AUDIT (ROUND 3): CONDITIONAL PASS

PREVIOUS (DEEP-2) CONDITIONAL PASS:  PARTIALLY CONFIRMED
  - Revenue/Cost/Profit/Margin/Outstanding:  RE-CONFIRMED
  - PH23-01/D1/D2:                            RE-CONFIRMED
  - Dead Stock / Fast Mover / Dead Capital:   NOT PREVIOUSLY AUDITED → PH23-D3

DEAD STOCK / DEAD CAPITAL / FAST MOVER:  was WRONG (salesCount = Quick-Sell-only) → FIXED
  - demo "Dead Capital" 1,06,206 → 19,638; a 15-unit / ₹39,508 part off the Dead Stock list
PARTS PROFITABILITY (ledgerByPart):     MATCHES (frozen sales ledger)
INVENTORY VALUATION:                    MATCHES (potential metric, correctly labelled)
VEHICLE ANALYTICS:                      MATCHES (isRealized-gated; GST-inclusive turnover, intentional)
CUSTOMER ANALYTICS:                     MATCHES (post PH23-D2)
WORKSHOP KPIs:                          MATCHES
GST / COLLECTION / COUNTS / AVG / TREND: MATCHES
LIVE DEMO:                              PH23-D3 fix verified (seed reconciliation + runtime path)
AUTHENTICATED PRODUCTION:               NOT PERFORMED (tooling limit)
FIRESTORE RULES:                        unchanged; 2/2
MUTATION TESTING:                        19 / 19 corruptions detected (DEEP-1/2/3 cumulative)

NEW DEFECTS:                    1  (PH23-D3)
CRITICAL 0 · HIGH 0 · MEDIUM 1 · LOW 0
FIXES:                          1
PRODUCTION NET LINES:           +24  (2 files; ~18 comment; 0 new fn/abstraction)
COMMIT:                         c88149e
DEPLOYMENT:                     Vercel HFYOTlreDO_aSWc9UsfyT (/, /login, /verify → 200;
                               deployed bundle carries DEMO_SCHEMA v5 + the salesCount
                               moves, and no longer the v4 schema string)
                               (docs commit 86ea548 re-triggered a code-identical
                               rebuild → current prod buildId v2V3tOWTXK-JYT1ggrdmf)
QA CLEANUP:                     complete
FINAL CONFIDENCE:              HIGH for the analytics math + semantics; MEDIUM-HIGH overall
                              (pending an authenticated-production spot-check)
```

---

## AUTHENTICATED PRODUCTION READ-ONLY SPOT-CHECK

**Attempted twice, 2026-09-07 (this session). Result: BLOCKED — an authenticated
production session could not be established from this environment. 0 production
records read, 0 modified, no mutation occurred, no authenticated production number
was fabricated.**

### Authentication result — BLOCKED

Every browser surface available to this session was tried, twice (the second attempt
after the user reported connecting an authenticated Chrome session):

| Surface | Result |
|---|---|
| **Claude in Chrome** (`mcp__claude-in-chrome__*`) — the user's real Chrome with its existing logged-in sessions | **Never paired with this session.** `list_connected_browsers` returned `[]` (and the action tools "not connected") on ~10 attempts across both tries, including after the user opened and signed into the extension side panel. The Chrome extension does not bridge to this Claude Code session. |
| **In-app Browser pane** (`mcp__Claude_Browser__*`) — sandboxed browser | The app's main bundle **`/_next/static/chunks/pages/index-<hash>.js` (~1.5 MB) fails with `net::ERR_FAILED`** every time — confirmed three ways: the network log, an in-page `fetch()` of the same URL ("Failed to fetch"), and a 100 KB `Range` request of it (also fails) — while small chunks and a shell `curl` of the identical URL both return **200**. The sandbox blocks that specific large resource. The entire authenticated app (Dashboard, Analytics, Billing, Reports, Customers, Vehicles) is served from that one bundle, so **nothing past `/login` can render there** — this is not a login problem, and having the user sign in there would change nothing. Firebase Auth / Firestore XHR would additionally be blocked. |
| **Logging in myself** | Not permitted — entering credentials to authenticate is a hard safety boundary. |

Root cause, stated plainly: **the Claude execution environment's network-egress policy
prevents this session from loading `balaji-auto-os.vercel.app` in a usable browser, and
no browser surface available to the session can provide an authenticated production
Firestore session.** Per §12 of the brief, the check is reported BLOCKED, not assumed
to pass.

### A complete read-only checklist was prepared for the user

Because the reconciliation is sound in principle and only the *tooling* is blocked, a
full **BATCH 1 → BATCH 6** read-only checklist was written and handed to the user to
run in their own authenticated browser (ledger baseline via the existing
`window.__txnCounts()` debug hook + `buildId`; 3 specific invoices source→ledger;
one month's totals; receivables / Outstanding / Draft-Estimate KPIs; Dead Capital /
Dead Stock / `salesCount`; cross-view Revenue; a before/after `__txnCounts()` mutation
anchor). If the user returns that evidence, the independent reconciliation can be
completed and the classification revisited without another audit pass.

### What *was* verified this session (unauthenticated, from the shell — when egress was available)

| Check | Result |
|---|---|
| `GET /`, `/login`, `/verify` | **200** (repeatedly over the session) |
| Current production `buildId` | `v2V3tOWTXK-JYT1ggrdmf` — the rebuild triggered by docs commit `86ea548`, **code-identical to `c88149e`** (the only file differing between the two commits is this report). So the PH23-D3 fix is live. |
| Deployed bundle content | contains `v5-salescount-from-ledger` and the `salesCount` diff-move; **does not** contain `v4-jobcard-real-statuses`. |
| `firestore.rules` | unchanged this phase; `npm run test:rules` 2/2 (150 + 111), including anon-read-DENIED coverage. |

### Records inspected / independent calculations / source-ledger-rollup-analytics-dashboard values

**UNAVAILABLE** — every one of these requires reading authenticated production
Firestore, which was blocked. Nothing was read, so nothing is reported. No numbers
are fabricated.

- Revenue / Cost / Gross Profit / Margin per invoice — **UNAVAILABLE**
- Historical-cost production check (PH23-D1) — **UNAVAILABLE — additionally, no
  naturally-occurring production record with a differing catalogue/snapshot cost was
  identified, because the catalogue could not be read.**
- Monthly reconciliation (Revenue / Cost / Profit / Margin vs `salesRollups` vs
  Analytics vs dashboard trend) — **UNAVAILABLE**
- Receivables (PH23-D2 — Outstanding / Pending / Total Spent vs invoice statuses,
  Draft/Estimate not counted as owed) — **UNAVAILABLE**
- `salesCount` / inventory-KPI divergence (PH23-D3) — **UNAVAILABLE**
- Cross-view Revenue-definition consistency (Dashboard / Analytics / Sales / Billing /
  Customer / Vehicle / Reports) — **UNAVAILABLE**

### Confirmation of no production mutation

**Confirmed — trivially.** No authenticated session was ever established, so no
read or write reached production Firestore. The Browser pane only ever loaded the
public shell and the `/login` form. `git status` clean apart from documentation.
`CODE CHANGES: 0`.

### Classification impact — this is the FINAL Phase 23 determination

Phase 23 is closed at **CONDITIONAL PASS**, confidence **MEDIUM-HIGH**. The analytics
math and semantics are fully verified by source trace + hand oracle + mutation testing
(19/19) + demo-mode live verification across every KPI family; **the sole open item is
that the four fixes have not been reconciled against authenticated production data, and
that is blocked by the environment's network-egress policy / browser tooling — not by
any known or suspected analytics defect.**

- **DEEP-4 is explicitly NOT recommended** to compensate for the blocked spot-check —
  four adversarial passes have exhausted the "source → intermediate transform → wrong
  meaning" surface at diminishing returns, and another code pass would not substitute
  for a production reconciliation.
- **No further analytics code changes** unless a new concrete defect is found.
- The authenticated production reconciliation remains available to the user as the
  BATCH 1–6 read-only checklist; running it later can upgrade this to PASS without
  reopening the audit.

```
AUTHENTICATED PRODUCTION CHECK:   BLOCKED (environment network-egress policy; no authenticated
                                  production Firestore session obtainable this session)
RECORDS READ:                     0
RECORDS MODIFIED:                  0
REVENUE:                          UNAVAILABLE
COST:                             UNAVAILABLE
GROSS PROFIT:                     UNAVAILABLE
MARGIN:                           UNAVAILABLE
HISTORICAL COST:                  UNAVAILABLE
MONTHLY TOTALS:                   UNAVAILABLE
RECEIVABLES:                      UNAVAILABLE
SALE COUNT / INVENTORY KPI:       UNAVAILABLE
CROSS-VIEW:                       UNAVAILABLE
PRODUCTION MUTATIONS:             0
FABRICATED PRODUCTION NUMBERS:    0
NEW DEFECTS:                      0
CODE CHANGES:                     0
FINAL PHASE 23 STATUS:            CONDITIONAL PASS  (confidence MEDIUM-HIGH; Phase 23 closed)
```
