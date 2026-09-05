# Final Pre-Phase-16 Baseline Audit — Phases 1–15

A clean, internally-consistent, production-ready baseline check before
Phase 16. **Not** a feature phase and **not** a new bug hunt — a
documentation / deployment / cleanliness reconciliation.

## 1. Current production version

Production (`https://balaji-auto-os.vercel.app`) serves the latest `main`
commit. Vercel redeploys on every push, including docs-only commits, so the
live build id corresponds to `4cce088` (the most recent commit), which
transitively includes the Phase 15 code fix `7b5520c`.

## 2. Git HEAD

```
4cce08831276bac8fb46821774216e6127217640
4cce088  docs: record Phase 15 deployment and production verification
```

Working tree before this baseline's own doc edits: clean except one
untracked file (`.claude/launch.json` — a benign local dev-server launch
config, now added to `.gitignore`).

## 3. Vercel deployment

**PASS.** Live buildId `Rl3aFHPBosq4k-7c1GODo` (changed since Phase 15's
recorded `rrbvmI8DBW3GBXkFLZqL6` because the two subsequent docs commits
each triggered a fresh redeploy — expected). App loads, authenticates
(`konabhargav2003@gmail.com`), all read paths render, zero console
messages of any kind across Dashboard / Inventory / Customers / Billing /
Sales.

## 4. Firebase rules deployment

**BLOCKED — manual action required.** Phase 15's `firestore.rules` change
(PH15-03: `auditLog` `create` now requires
`performedBy == request.auth.uid`) is committed in the repo (`7b5520c`) and
passes the emulator suite (138/138), but **is not deployed to the live
`balaji-auto-os-7` project**:

- This repo's CI (`.github/workflows/ci.yml`) runs lint/build/test only —
  it does **not** run `firebase deploy`. Rules have always been a manual
  publish step in this program (memory + Phases 1b/2 notes).
- The `firebase` CLI in this environment has **no authenticated account**
  (`firebase login:list` → "No authorized accounts"), no `FIREBASE_TOKEN`,
  and no service-account key. `firebase login` requires an interactive
  browser OAuth flow that cannot be completed autonomously, and deploying
  production security rules is in any case a shared-infrastructure change
  that should be done deliberately by the owner.

**Required remediation (owner runs this once):**
```
cd <repo>
npx firebase login          # one-time, interactive
npx firebase deploy --only firestore:rules --project balaji-auto-os-7
```
Then re-run `npm run test:rules` locally to confirm the ruleset is
unchanged from the reviewed one. Do **not** edit `firestore.rules` to make
deployment easier — deploy exactly `7b5520c`'s version.

Until this is done, the live `auditLog` create rule still lets any
signed-in client write an entry with a forged `performedBy`. This is a
MEDIUM audit-integrity gap (the app itself always writes the correct
value; the shared, authoritative auditLog entries via `pushAudit`/
`writeAudit` are unaffected), not a data-loss or financial risk.

## 5. Phase 1–15 status matrix

| Phase | Status | Main result | Fix commit | Tests (at phase) | Rules (at phase) | Deployment |
|---|---|---|---|---|---|---|
| 1a | DONE | `_rev` optimistic-concurrency guarded entity saves | `4ca54a4` | — | — | live |
| 1b | DONE | Single-active-editor edit lease (`editLocks`) | `189dfdc` + `036207c` | — | — | rules published by owner; 2-tab verified |
| 1c | DONE | Live record-update + conflict-review UX | `9ebb165` + `ab33813` + `00fe190` | — | — | live, prod-verified (TEST 1–15) |
| 2 | DONE | Server-side invoice/estimate counter (`counters/<seq>`) | `fb373ee` | — | — | rules published; 1/2/3-client prod-verified |
| 3 / 3b | DONE | Cross-workflow race closure (payment double-realization, PO over-receipt, customer LWW) | `0ec2978` | 125/125 | 76/76 | live, 2-tab prod-verified |
| 4 / 4b | DONE | Duplicate-action idempotency (opId-keyed markers everywhere) | `1c7de90` | 126/126 | 88/88 | live |
| 5 / 5b | DONE | Refresh/reload-safe business operations (durable opId in sessionStorage) | `85e4cd3` (+ `dd11532` docs) | 127/127 | 94/94 | live, prod-verified |
| 6 / 6b | DONE | Offline recovery + bounded transaction UX (`lib/txTimeout.js`) | `5d0546d` | 128/128 | 98/98 | live, prod-verified |
| 7 / 7b | DONE | Tab-identity / editor-lifecycle hardening (PH7-01 duplicated-tab opId, PH7-27 lease session identity) | `9944e0f` | — | — | live |
| 8 / 8B | DONE | Partial-failure transaction boundaries (one atomic txn per business op: invoice realization, reservation, batch) | `b8824d5` | — | — | live |
| 9 | DONE | Orphan-record / broken-relationship integrity (PH9-01/02 part-deleted-mid-transaction) | `4eeb892` (+ `f2c81e7` docs) | 131/131 | — | live, prod-verified |
| 10 | DONE | Referential integrity (PH10-01 jobNo reuse, PH10-02/03 id-first customer/vehicle matching) | `b8cad8a` (+ `985db11` docs) | 132/132 | — | live, prod-verified |
| 11 | DONE | Financial integrity (PH11-01 double stock restoration, PH11-02 overpayment mislabel + edit/payment race) | `067f901` (+ 3 docs) | 133/133 | 133/133 | live, prod-verified |
| 12 | DONE | Inventory accounting integrity (PH12-01 Edit Part silently reverting live stock) | `5fe8370` (+ `6a03e2e` docs) | 134/134 | 133/133 | live, prod-verified |
| 13 | DONE | Authoritative-field stale-snapshot (PH13-01 Supplier name/phone quick-edit not bumping `_rev`) | `fb46721` (+ `e7fbdee` docs) | 135/135 | 133/133 | live, prod-verified |
| 14 | DONE | Ledger / business-event integrity (dead duplicate-ledger-write hazard removed from `recordInvoiceSalesDelta`) | `3b35f7e` (+ `16f2ccb` docs) | 136/136 | 133/133 | live, prod-verified |
| 15 | DONE (code) / **rules pending** | Audit-log integrity (PH15-01 hardcoded actor placeholders, PH15-02 partial-payment audit label, PH15-03 `auditLog` create-rule forgery) | `7b5520c` (+ `7aa9e48`, `4cce088` docs) | 137/137 | 138/138 | app live & verified; **`firestore.rules` NOT yet published** |

Every fix-commit SHA above was verified to exist in `git log`. History is
linear, one fix commit + one or more docs commits per phase, no amended or
force-pushed commits.

## 6. Test baseline (run now against HEAD `4cce088`)

```
npm test              137/137 test files passed
npm run test:rules    138/138 passed (against the emulator)
npx eslint .          0 errors, 38 warnings (all pre-existing:
                      react-hooks/exhaustive-deps + next/no-img-element)
npm run build         compiled successfully, exit 0
```

Matches Phase 15's own recorded counts exactly — no regression. Phase 1–15
test files are all present and included in `npm test` (`tests/run-all.cjs`
globs `tests/*.test.cjs`). No test was found duplicated, skipped,
unreachable, or depending on production data / the live environment —
every suite runs the real shipped code under Node/jsdom or the local
Firestore emulator.

## 7. Rules baseline

138/138 emulator assertions pass. `firestore.rules` is byte-identical to
commit `7b5520c` (no accidental local modification). Phase 15's 5 new
`auditLog` self-attribution scenarios pass; every earlier scenario
(Phase 1b lease, Phase 2 counter, Phase 8B pendingSales, append-only
ledger pattern, privilege-escalation) remains green.

## 8. Lint / build baseline

0 lint errors. The 38 warnings are the same long-standing set
(`react-hooks/exhaustive-deps` on listener effects, `next/no-img-element`
on base64 image previews) documented since v1.0.0 — not introduced by any
recent phase. Build compiles and prerenders all 4 static routes.

## 9. Documentation consistency

**One genuine stale claim found and corrected:**
`docs/KNOWN_LIMITATIONS.md` opened with a blanket parenthetical *"(The
reference deployment — Firebase project `balaji-auto-os-7` — has the rules
published.)"* — true as of Phase 14, but Phase 15 added a rules change
that is not yet deployed (§4). Corrected to state exactly which change is
pending and what it means until published.

**Checked and left as-is (correctly historical, per the audit's own rule):**
- `docs/RELEASE_NOTES.md` "119/119 test files passing" and
  `docs/CHANGELOG.md` — both explicitly scoped to the **v1.0.0 release**
  (a frozen tag), not a running scoreboard. This program's convention
  keeps CHANGELOG/RELEASE_NOTES frozen at v1.0.0 and uses ROADMAP.md +
  KNOWN_LIMITATIONS.md as the living per-phase status docs.
- Every `docs/testing/PHASE_*.md` report's own test/rules counts — each is
  correct as of its own phase; the progression (131→132→…→137,
  133→…→138) is internally consistent across the reports and ROADMAP.md.
- `docs/testing/TESTING.md` — a general "how to run the suites" guide with
  no absolute counts; the named suites it references all still exist.

No contradiction found between any doc and the current architecture. No
doc references a removed helper/file. No obsolete TODO/FIXME anywhere in
`components/`, `lib/`, `services/` (zero matches).

## 10. Repository cleanliness

| Candidate | Verdict | Note |
|---|---|---|
| `.claude/launch.json` (untracked) | DOCUMENT → gitignore | Benign local dev-server launch config; added `.claude/` to `.gitignore` (like `.vscode`) so `git status` stays clean |
| `.env.local.example` (tracked) | KEEP | Placeholder template only; its own comment notes "public client keys, not secrets" — correct per Firebase's model |
| `.github/workflows/ci.yml` Firebase `apiKey` | KEEP | Real project client key, but Firebase client keys are **not secrets** (Firestore rules are the boundary); already shipped to every browser anyway; documented design |
| Largest tracked file (`InventoryDashboard.js`, ~972 KB) | KEEP | The central component; large but intentional, drives the Babel "500KB" notes |

No untracked test files, temp scripts, generated reports, screenshots,
logs, debug files, archives, stale backups, `.env` files, service-account
keys, tracked `node_modules`, or tracked build/cache output. `.gitignore`
already covers env files, logs, `.next/`, `.vercel`, coverage, caches, OS
files.

## 11. Dead-code observations

A full dead-code / duplicate-writer / stale-snapshot / missing-`_rev`
investigation was already performed and is documented in the Phase 10–15
reports (Phase 14 specifically removed the one dead duplicate-ledger-write
hazard). This baseline pass re-confirmed **no regression**:

- `pushAudit` / `writeAudit` — still exactly two helpers, non-overlapping
  domains (Phase 14/15 finding, unchanged); not a defect.
- No remaining hardcoded actor placeholder (`by: 'Admin'` / `'You'` /
  `'Staff'`) anywhere in `components/` — Phase 15's fix was complete.
- Zero `TODO` / `FIXME` / `XXX:` in production source.
- `recordInvoiceSalesDelta`'s dead production branches — already removed in
  Phase 14 (`3b35f7e`); confirmed still absent.
- Lint's `no-unused-vars` clean (0 errors), so no dead imports / unused
  variables introduced by Phases 13–15.

No new investigation opened — no obvious candidate presented itself.

## 12. QA residue status

The live `balaji-auto-os-7` Firestore project currently contains **almost
no real business data** — it has functioned as an iterative test
environment across this 15-phase program:

| Data | Count | Classification | Action |
|---|---|---|---|
| Parts (`parts` collection) | **0 live documents** | All QA test parts already removed in earlier phases | None needed |
| Customers | **1** — "QA Production Smoke Test" (`CUST-0001`, `qa-smoke-test@example.test`), 1 vehicle, 1 invoice ₹1,680 | **UNCERTAIN** — clearly test data by name, but it is the *only* customer + invoice + vehicle in the whole system, provenance not certain (may predate this session's visible window or be the owner's own reference) | **Not deleted.** Removing the only customer/invoice/vehicle from a real production project is a destructive, hard-to-reverse action with ambiguous provenance — the owner should confirm before removal |
| Sales ledger (`sales`) | 9 rows, all QA parts (`PH9-ORPHAN-PART`, `ZZ-QA-PH5B-PART`, `ZZ-QA-PH4B-PART`, `ZZ-QA-PH4-PART`, incl. one compensating `-1` reversal row) | Intentional, immutable historical residue | **Not removed.** These are append-only ledger rows; the app has no "delete a sales row" affordance, and deleting them via the Console would itself violate the append-only-ledger invariant this entire program protects. Documented, not cleaned. |
| `restocks` / `stockAdjustments` | QA-part rows referencing now-deleted parts | Same as above | Same — documented, not removed |
| `Dashboard → Insights` "`ZZ-QA-PH5B-PART` is trending" | derived from the ledger rows above | Cosmetic echo of the ledger residue | Self-resolves when/if the ledger is ever reset by the owner |

No safe, non-destructive, in-app cleanup path exists for any of this
residue. The correct owner action (if a clean slate is wanted before real
data entry) is a deliberate Firestore Console / script reset of the
`parts` / `customers` / `sales` / `restocks` / `stockAdjustments` /
`invoices` / `jobCards` collections — outside this baseline's scope and not
something to perform autonomously.

## 13. Security / secret check

**PASS.** No secrets tracked. `.env.local` and every `.env.*` variant are
gitignored ("NEVER commit these"). No service-account JSON, no
`-----BEGIN … PRIVATE KEY-----`, no `ghp_…` / `sk-…` tokens anywhere in
tracked files. The only key-shaped string in the repo is the Firebase
**client** `apiKey` in `ci.yml` — not a secret by Firebase's design
(confirmed against this repo's own `.env.local.example` comment), left
in place per "do not rotate credentials merely because they exist". The
bootstrap-owner-password caveat (KNOWN_LIMITATIONS §🔴) is a deployment
config item, unchanged.

## 14. Production smoke

**PASS** (read-only; no create / edit / delete / pay / sell / receive /
mutate):

| Check | Result |
|---|---|
| App loads | ✓ |
| Authentication | ✓ signed in as `konabhargav2003@gmail.com` |
| Dashboard | ✓ renders (Inventory Health, Workshop Score, Insights) |
| Customers read | ✓ 1 customer renders correctly (the QA record) |
| Billing read | ✓ KPIs, revenue trend, payment-mode donut render |
| Inventory read | ✓ Parts tab renders empty-state correctly (0 parts) |
| Sales ledger | ✓ "Showing 9 of 9" rows render with correct amounts |
| Console errors | ✓ zero, on every page |
| Navigation | ✓ no broken links across bottom nav + side menu |
| Deployed build == intended | ✓ latest `main` |

## 15. Confirmed issues

1. **Firestore rules deployment pending** (§4) — Phase 15's PH15-03 rule
   change is committed but not published to the live project; CI does not
   deploy rules and this environment cannot authenticate. **Owner action
   required.** MEDIUM severity, audit-integrity only.
2. **Documentation staleness** (§9) — `KNOWN_LIMITATIONS.md`'s blanket
   "rules published" claim was inaccurate post-Phase-15. **Fixed in this
   baseline** (doc edit only).
3. **QA-only production data** (§12) — the live project holds one QA
   customer/invoice and QA-part ledger residue, no real business data.
   Informational, not a defect; **owner should decide** whether to reset
   before real use.

## 16. Fixes

- **Documentation:** `docs/KNOWN_LIMITATIONS.md` — corrected the stale
  "rules published" parenthetical to name the pending Phase 15 rule change.
- **Repository hygiene:** `.gitignore` — added `.claude/` (per-developer
  local tool config).
- **No production-code change. No test-code change.**

## 17. Code-growth review

```
PRODUCTION CODE CHANGES:   none
TEST CODE CHANGES:         none
DOCUMENTATION CHANGES:     docs/KNOWN_LIMITATIONS.md  (1 stale claim corrected)
                           .gitignore                 (+3 lines: .claude/)
```

This baseline produced zero production-code and zero test-code changes, as
intended. No defect was found that warranted a code fix — the one
operational gap (rules deployment) is an environment/credentials
limitation the owner must resolve, not a code bug.

## 18. Final readiness assessment for Phase 16

**READY FOR PHASE 16**, with one owner-action item outstanding:

- All four gates green (137/137 tests, 138/138 rules, 0 lint errors,
  build ✓) against a clean, linear git history.
- Production is serving the latest `main`; all read paths verified; zero
  console errors.
- Documentation is now internally consistent; the one stale claim is
  corrected.
- Repository is clean (one benign local config, now gitignored); no
  secrets; no dead code regression.
- **Outstanding:** the owner must run `firebase deploy --only
  firestore:rules` once to publish Phase 15's `auditLog` rule (§4). This
  does not block starting Phase 16 — it is an audit-integrity hardening,
  not a correctness or data-safety blocker — but it should be done before
  the audit trail is relied on as tamper-evident.
- **Note for Phase 16 scoping:** the live project currently holds only QA
  test data (§12). If Phase 16 involves production data verification, the
  owner may want to either enter real data first or explicitly confirm the
  QA records are acceptable to work against.
