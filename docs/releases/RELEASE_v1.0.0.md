# Balaji Auto OS — v1.0.0 · RELEASE

Code-freeze release. Ten sprints of fixes, all verified by an executable test suite that
ships inside the repo (tests/) and runs against the REAL shipped code — no mocks of the
logic under test.

## RELEASE GATE — all green

    next build            ✓ compiled successfully
    undefined-identifier  0 real (4 false positives: CSS/self/caches, all guarded)
    TDZ scan              0
    ─────────────────────────────────────
    218 automated assertions, 0 failures

    overpayment     7    dropdowns      14    export         15
    regression     46    scrolllock     10    settings-dirty 14
    statcards      18    vehiclestats   33    perf           20
    ui-consistency 15    certification  26

## WHAT THIS RELEASE CERTIFIES (executable, real code)

* TRANSACTION ENGINE — pay/cancel cascade is reversible, idempotent, never
  double-counts; totals derive from line items; stale grandTotal ignored; gapless
  numbering; refuses to consume stock beyond what was paid for.
* No invoice can be overpaid or marked paid while overpaid.
* Every Vehicle KPI matches the underlying data (the ₹71.35 Cr bug — a nested
  filter that summed the whole workshop's revenue per vehicle — is gone).
* Search is sub-millisecond at real dataset size (was 36 SECONDS/keystroke on
  Vehicles). No debounce lag anywhere; useDeferredValue keeps typing instant.
* Every export is a real .xlsx with date cells and column widths (no ########),
  numbers stay numeric (=SUM works), no column shift.
* One status-badge system, one colour map, one dropdown primitive, global focus
  trap, global focus ring, labelled icon controls.

## CODE-FREEZE DISCIPLINE (this sprint)

Audited for crash risks and memory leaks. Findings:
  * unguarded JSON.parse — NONE (both call sites already guarded)
  * .toFixed/.toLocaleString on non-numbers — NONE (all on computed aggregates)
  * addEventListener without cleanup — NONE (apparent imbalances are multi-add/
    single-return blocks, beforeunload, and a correctly-paired MediaQueryList)

The ONLY change made this sprint: APP_VERSION '12.4.0-rc.1' → '1.0.0', because the
app displayed an internal release-candidate string while package.json said 1.0.0.
No logic touched. 218/218 unchanged before and after.

## 🔴 MUST DO BEFORE GO-LIVE — NOT CODE, NOT OPTIONAL

These are configuration, cannot be fixed in the codebase, and outrank everything above.
The application logic is production-quality; the DEPLOYMENT is not safe until:

1. PUBLISH THE FIRESTORE SECURITY RULES.
   firestore.rules is correct in the repo. Until it is published in the Firebase
   console, ANY signed-in staff user can delete every invoice. The role checks in the
   UI (isAdmin / canManage) are guards, not a security boundary — they are bypassable
   without database rules.
2. SET A STRONG OWNER PASSWORD (never leave it at a weak default).

## KNOWN LIMITS (deferred, documented)

* Invoice numbering is not concurrency-safe. Two devices creating an invoice in the
  same second can collide. Needs a server-side counter (runTransaction). Low risk for
  a single-location workshop; must be fixed before multi-terminal use.
* Concurrent stock decrement has the same class of race.
* The main dashboard is one large component; keystrokes re-render it (interruptibly,
  via useDeferredValue) but not cheaply. Splitting it is a v1.1 refactor.
* No table virtualisation — fine at current data + pagination; revisit past ~10k rows.

## VERIFICATION CEILING — read this

Everything above is verified by executing code in Node/jsdom. NONE of it is verified
in a real browser or against live Firestore. Not covered here: actual rendering, pixel
layout, real Firestore round-trips, live concurrency, offline recovery, print/PDF
output. A human must click through a deployed build before final sign-off.

See [docs/testing/TESTING.md](../testing/TESTING.md) to reproduce the entire suite yourself.
