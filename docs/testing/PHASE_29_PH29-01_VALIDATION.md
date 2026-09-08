# PH29-01 — Targeted Validation

Follow-up validation of the Phase 29 fix (commit `cc8a2e8`), at the user's request.
**No production code was changed during this validation.**

## Classification: **PARTIALLY CONFIRMED**

The fix demonstrably defeats the modelled/simulated attack and preserves the
same-tab-reload refresh-safety guarantee — but the underlying vulnerability was
**never observed on a real browser**, and the fix **introduces a new, narrower
double-apply residual** that the old (Phase 7b) implementation did not have.

---

## 1. Was PH29-01 actually reproduced, or only inferred?

**Only inferred — never reproduced against a real browser.**

- The vulnerability requires the browser's "Duplicate tab" gesture to copy
  `window.name` into the new tab alongside the (spec-mandated) `sessionStorage`
  clone.
- This session has **no paired browser** and **no way to trigger a real
  "Duplicate tab" gesture**. It could not be observed.
- The claim that Chromium copies `window.name` on Duplicate Tab rests on knowledge
  of Chromium internals: "Duplicate tab" → `WebContents::Clone()` →
  `NavigationController::CopyStateFrom()` copies each entry's `PageState`, and
  `blink::ExplodedFrameState.target` (the serialised main-frame name, i.e.
  `window.name`) is part of that `PageState`. This is a **strong signal** that the
  Phase 7b assumption ("`window.name` resets to empty in any new top-level
  browsing context, including a duplicate") is **wrong for Chrome/Edge** — but it
  is a code-reading inference, not a live observation, and browser behaviour here
  has varied by version.

**Therefore: PH29-01 must NOT be stated as a confirmed production-browser
vulnerability.** It is a plausible, well-motivated, but unverified hypothesis.

## 2. Evidence classes used in this validation

| Result | Evidence class |
|---|---|
| `window.name` survives a same-tab **reload** | **actually observed** (Browser pane, this + prior session) |
| `window.name` is **empty in a genuinely new tab** | **actually observed** (Browser pane) |
| a new tab does **not** inherit another tab's `sessionStorage` | **actually observed** (Browser pane) |
| cross-tab `storage` events fire | **actually observed** (Browser pane) |
| **Chrome "Duplicate tab" copies `window.name`** | **NOT observed** — code-reading inference from Chromium `PageState` serialisation |
| OLD impl reuses the inherited opId when `window.name` + `sessionStorage` are both cloned | **deterministic execution of the real OLD source** + **simulated** in the Browser pane (manually cloned both) |
| NEW impl re-mints the page-instance id on that same simulated attack | **deterministic execution of the real NEW source** + **simulated live** in the Browser pane (2 tabs, one manually made a clone) |
| NEW impl: same-tab reload keeps its id + opId | **executed** + **observed live** |
| NEW impl: 2-/3-tab convergence, no loop, no thrash | **executed** (async-message-queue model of BroadcastChannel) |
| the 8a residual (original loses its own continuity) | **executed** + **observed live** |

"Simulated" throughout means: `window.name` and `sessionStorage` were manually
cloned from tab A into tab B to stand in for what a real "Duplicate tab" *might*
do. It is the worst case, not a captured native behaviour.

## 3. OLD (Phase 7b) implementation vs the exact simulated attack

Ran the **real `git show 79028d4~2:lib/durableOpId.js`** in an isolated fake
browsing context. Tab A starts a ₹500 payment (opId `p_…`, stored). Tab B =
"Duplicate tab": **both `window.name` and `sessionStorage` cloned**. Tab B runs a
genuinely different ₹700 payment on the same scope.

```
opA = p_mts3uiex_4imyse9u
opB = p_mts3uiex_4imyse9u        ← inherited, IDENTICAL
invoice total = ₹500            ← Tab B's ₹700 swallowed as a duplicate (backend marker)
B.alreadyApplied = true         ← false-success path
```

**Result: OLD is vulnerable to the simulated attack — Tab B's ₹700 is lost,
reported as success.** (This is *not* proof it is vulnerable on a real Chrome — it
is proof that IF Chrome clones `window.name`, OLD fails.)

## 4. NEW (BroadcastChannel) implementation vs the same simulated attack

Ran the **real current `lib/durableOpId.js`** in the same harness, and **live in
the Browser pane** with two real tabs (tab B manually given tab A's `window.name`
+ `sessionStorage`, then reloaded).

```
Harness:  piA  ph7b:pi:mts3uig3… → ph7b:pi:mts3uig5_auj9l4ni   (re-minted)
          piB              →       ph7b:pi:mts3uig5_qmwz65b4   (re-minted, distinct)
          opA = p_mts3uig4_dkux7asm
          opB = p_mts3uig6_npf1xnqi                            ← FRESH, not inherited
          invoice total = ₹1200                                ← BOTH payments land

Live:     seed  ph7b:pi:mts489bd… → ph7b:pi:mts49baw_lrvyp6k2  (re-minted)
          tab-1 (the "duplicate")  → ph7b:pi:mts49bbb_mxtzo0i6 (re-minted, distinct)
          the inherited entry stays tagged with the OLD id → readOrCreateOpId
          would mint a fresh opId for a new intent, NOT reuse p_ORIGINAL_500
```

**Result: NEW defeats the simulated attack** — the duplicate re-mints its
page-instance id (via the BroadcastChannel collision), so an inherited opId is
never reused for a new intent, regardless of whether `window.name` was cloned.

## 5. Critical non-regression — same-tab reload

Harness + live (seed as the only tab): armed `window.name = ph7b:pi:NONREG…` and an
in-flight opId `p_myown_inflight_999`, then reloaded.

```
window.name kept       = true   (ph7b:pi:NONREG_stable01 unchanged — no false re-mint)
opId reused             = true   (p_myown_inflight_999 still recognised as ours)
hadPending banner       = true
retry → alreadyApplied  = true, invoice total stays ₹500 (no double charge)
```

**Result: PASS — the Phase 5b/6b refresh-safety guarantee is fully preserved.** A
same-tab reload has no live sibling, so the collision watch never fires.

## 6. Genuinely separate new tab → separate page-instance id

Harness + live (tab-1 opened as a genuine new tab **before** being turned into a
simulated clone):

```
piA   = ph7b:pi:mts489bd_mfsqcdbt
piN   = ph7b:pi:mts48qcr_gdocp771     ← distinct
tab-1 did NOT inherit seed's sessionStorage opId entry (null)
no collision fired — piA unchanged
```

**Result: PASS.**

## 7. 2-tab / 3-tab convergence, loop & thrash

Async-message-queue model of BroadcastChannel (delivery as a task, matching the
platform), executed against the real source.

```
2-tab: bus settled in 5 messages; piA and piB distinct; a 2nd drain changes nothing
3-tab: bus settled in 5 messages; all three ids pairwise-distinct; 2nd drain no-op
```

- **No infinite loop** — a re-minted context ignores messages for an id it no
  longer holds, so the echo→mint→re-announce sequence terminates. The harness caps
  the queue at 5000 iterations and would throw; it never approached it.
- **No identity thrashing** — a second drain after convergence changes nothing;
  once every context holds a unique id there are no more collision messages.

## 8. Failure-mode probes on the NEW implementation

| Probe | Result |
|---|---|
| **Lose a legitimate in-flight opId?** | The **currently-open** modal pins its opId in a React ref, so its *in-progress* operation is unaffected. **BUT** — see the 8a residual below: if the original re-mints (collision) and then **closes + reopens** that modal, the reopen gets a **fresh** opId and **no `hadPending` banner**. Executed + observed live. |
| **Cause duplicate execution?** | Yes, in the 8a residual only: original re-mints → modal reopen → fresh opId → if the original op *had committed*, a retry applies it a **second time** (₹1000). Requires: [window.name cloned] + [duplicate made during the original's ambiguous op] + [original closes+reopens the modal] + [original op had committed]. |
| **Cause a retry to lose idempotency?** | Only in the 8a residual (same chain). The **normal** retry flow (no duplicate) still recovers the same opId and dedupes — executed. |
| **Both tabs re-mint incorrectly (spurious collision)?** | No. A genuinely separate tab (own fresh `window.name`, own empty `sessionStorage`) does not trigger a collision — executed (§8e). The watch only fires when two live contexts share the *exact same* `ph7b:pi:…` string. |
| **Leave stale listeners / channels?** | No. The `BroadcastChannel` is closed on `pagehide` (`{ once: true }`). Executed: live channel count 1 → 0 after `pagehide`. |
| **Behave incorrectly if BroadcastChannel is unavailable?** | Degrades to the Phase 7b `window.name`-only check. Same-tab reload still reuses the opId; a duplicate with a cloned `window.name` falls back to the pre-fix behaviour (`opB === opA`). **No worse than before the fix** — executed (§8b). |

### The 8a residual (new, introduced by this fix)

**OLD (Phase 7b) did NOT have this**: with `window.name` cloned, the original's own
`peekOpId`/`readOrCreateOpId` see `entry.pi === pi` (both the cloned old value), so
the original keeps its `hadPending` banner and the same opId across a modal reopen.

**NEW**: when the collision fires, **both** contexts re-mint (symmetric). The
original's own in-flight `ph5b:op:*` entry is left tagged with the *old* id, so a
modal reopen in the original:

```
seed (original) after collision: window.name mts489bd → mts49baw
  its own entry {opId: p_ORIGINAL_500, pi: mts489bd}  — pi no longer matches
  modal reopen → peekOpId() = null (NO "check the record first" banner)
               → readOrCreateOpId() = a FRESH opId
  if p_ORIGINAL_500 had committed and the user retries → SECOND charge (₹1000)
```

Observed live (`residual_ownContinuityLost: true`) and in the harness (`total ₹1000`).

**Severity of the residual: comparable to PH29-01 itself.** Both are gated by the
same unverified antecedent (`window.name` cloned) + the same rare gesture
(duplicate a tab during an in-flight operation). After that:

- PH29-01 needs: go to the *duplicate* and perform a *different* operation on the
  same scope.
- 8a needs: in the *original*, close + reopen the operation modal, retry the *same*
  operation, and the original operation had already committed. (The "check the
  invoice, then reopen to pay" flow the ambiguous-failure toast itself suggests
  *is* a close+reopen.)

Mitigations that survive: the payment transaction's in-tx overpay guard rejects a
2nd payment that overflows the balance; quick-sell / adjust produce a *visible*
extra ledger row (not silent corruption).

## 9. Is the +65/−7 change necessary? Is there a simpler mechanism?

**Necessity: defensible, not proven.**

- If Chrome does **not** clone `window.name` on Duplicate Tab → the Phase 7b fix
  already works and this change is unnecessary defense-in-depth that also adds the
  8a residual.
- If Chrome **does** clone it → the Phase 7b fix is broken (executed proof against
  the simulated attack) and a hardening is warranted.
- The Chromium `PageState` evidence leans towards "does clone", but this was not
  verified.

**Simpler mechanisms considered and rejected:**

| Candidate | Why not |
|---|---|
| tag opId entries with `sessionId` (guaranteed fresh per context) | `sessionId` is **not** stable across a same-tab reload → would break Phase 5b refresh-safety |
| `localStorage` heartbeat + recency check | false-positive re-mint on a legitimate reload when `pagehide` doesn't run to completion (bfcache / crash) |
| reuse an existing app cross-tab primitive | there is none exposed at the app level (`persistentMultipleTabManager` is Firestore-internal) |
| do nothing — keep Phase 7b + its documented "not verified on every browser" residual | a legitimate option given the threat is unverified; this is the "revert" path |

`BroadcastChannel` is genuinely the simplest primitive for "is another live
context using my id right now" and is a single standard Web API (Safari 15.4+,
2022). It is not a framework.

**But the current implementation ("both sides re-mint") is not the minimal-risk
form.** A refinement — on re-mint, migrate the `ph5b:op:*` entries this context has
*already handed out an opId for* (tracked in a `Set`) to the new page-instance id —
would keep the *original's* continuity and close the more-likely half of the 8a
residual (~8 more lines). This was **not** applied, per the instruction to make no
further production change during validation.

## 10. Regression gates (re-run, this validation)

```
npm test           → 150/150 test files
npm run test:rules → 2/2  (150 + 111 assertions)
npm run lint       → exit 0
npm run build      → ✓
git status         → clean (no production code changed during validation)
```

## 11. Recommendation

Three defensible paths — the choice depends on risk appetite and on getting a real
browser to verify the `window.name`-clone behaviour:

1. **Verify first.** On a real Chrome/Edge: set `window.name`, use the actual
   right-click "Duplicate tab", read `window.name` in the duplicate. If empty →
   PH29-01 is not real on that browser and this change can be **reverted**
   (restoring Phase 7b + its honest "not verified on every engine" residual). If
   carried over → PH29-01 is confirmed and the fix stays.
2. **Keep + refine.** Keep the `BroadcastChannel` mechanism but add the
   owned-scope migration on re-mint, so the *original* never loses its own
   in-flight continuity. Closes the more-likely half of the 8a residual.
3. **Keep as-is + document.** Accept the 8a residual (same rarity class as
   PH29-01, gated by the same unverified antecedent) and document it in
   `KNOWN_LIMITATIONS.md`.

**Do not classify PH29-01 as a confirmed production-browser vulnerability, and do
not classify the fix as a CONFIRMED FIX, on the current evidence.**

---

### FINAL

```
PH29-01 VALIDATION:            PARTIALLY CONFIRMED

VULNERABILITY REPRODUCED?      NO — inferred from Chromium PageState internals;
                              never observed on a real browser (no paired browser,
                              no way to trigger a real "Duplicate tab" gesture)
OLD impl vs SIMULATED attack:  FAILS (executed real source + live simulation)
NEW impl vs SIMULATED attack:  DEFEATS it (executed real source + live 2-tab simulation)
SAME-TAB RELOAD NON-REGRESSION: PASS (executed + observed live)
SEPARATE NEW TAB → OWN ID:     PASS (executed + observed live)
2-/3-TAB CONVERGENCE:          PASS — no infinite loop, no identity thrashing (executed)
CHANNEL / LISTENER LEAK:       NONE — closed on pagehide (executed)
BROADCASTCHANNEL UNAVAILABLE:  degrades to Phase-7b behaviour — no worse than before

NEW RESIDUAL INTRODUCED:       8a — the ORIGINAL loses its OWN in-flight continuity
                              after a collision re-mint; a modal reopen → fresh opId,
                              no hadPending banner → double-apply IF the original op
                              had committed. Same rarity class as PH29-01. OLD impl
                              did NOT have this.

CHANGE NECESSARY?              Defensible, not proven (threat unverified). A minimal-
                              risk refinement exists (owned-scope migration on
                              re-mint) but was not applied per the no-further-change
                              instruction.

REGRESSION:                   npm test 150/150 · test:rules 2/2 · lint 0 · build ✓
PRODUCTION CODE CHANGED IN VALIDATION: no
```
