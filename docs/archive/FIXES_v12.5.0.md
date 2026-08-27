# Balaji Auto OS — v12.5.0-rc.1 · QA FIX PASS

Fixes for the 5 issues raised in manual QA, plus one showstopper found while fixing them.

## 🔴 CRITICAL — found during this pass (not reported)

**`save()` threw ReferenceError on every real invoice.**
`BillingModule.jsx` read `payments` at line 796 but declared `const payments` at line 833 —
same function, so a temporal dead zone. Save / Save & Collect / Mark as Paid ALL route
through `save()`. In v12.4.0-rc.1, **no real invoice could be saved at all.**

Consequence: the overpayment guard sat *below* the crash and had NEVER executed once.
That is why the live build happily marked an overpaid invoice as Paid.

Verified by executing the real component in jsdom: `tests/overpayment.test.cjs`.

## Issues fixed

1. **Vehicle dropdown clipped after 1 item** — root cause was NOT z-index. `Section` is
   `rounded-xl overflow-hidden`; an `absolute` panel inside it is CLIPPED. No z-index
   defeats an overflow clip. Panels now portal to `<body>` at `position: fixed`.
   Search now also matches engine number, chassis, RC, variant and customer name.
2. **Job card dropdown** — same clipping cause. Filtering was already correct
   (job no / customer / vehicle / reg / phone / status, partial, case-insensitive) and is
   now under test. React keys hardened (duplicate keys made React render the wrong row).
3. **Overpayment** — `balance` was floored by `Math.max(0, …)`, so ₹5,000 on a ₹4,799
   invoice showed balance ₹0 and the header flipped to "Mark as Paid". Now: excess is
   stated, field turns red while typing, error on blur, Save / Save & Collect disabled,
   `fullyPaid` can never be true while overpaid. Value is never auto-corrected.
4. **Modal focus trap** — one global trap (`lib/focusTrap.js`) covering all 38 overlays
   rather than 38 edits. Tab / Shift+Tab wrap, initial focus, focus restored on close,
   `role="dialog"` + `aria-modal`. NOTE: `ConfirmDialog` was documented as "correct" —
   it was not; it had no Tab trap either.
5. **Dropdown standardisation** — all 11 hand-rolled dropdowns converted to the one
   shared primitive `components/common/DropdownPanel.jsx`.

## Silent truncation (found while fixing #5)

Dropdowns were capping results and saying nothing — a workshop with 200 customers could
not reach most of them. Removed: `.slice(0,40)` customers · `.slice(0,8)` job-card
customer search · `.slice(0,60)` / `.slice(0,30)` / `.slice(0,20)`.
The two part searches are not virtualised, so a cap is retained — but it is now
**disclosed**: "Showing 50 of 132 matches — refine your search."
Analytics top-N slices were left alone; they are correct.

## Verification (all by executing real code — NO browser exists in that environment)

    next build                    ✓ compiled successfully
    scan-undef.cjs                4 findings, all false positives (CSS/self/caches)
    scan-tdz.cjs                  0
    tests/overpayment.test.cjs    7/7
    tests/regression.test.cjs    38/38
    tests/dropdowns.test.cjs      9/9   (standing guard — fails if anyone reintroduces
                                         an absolute panel or a silent search cap)

`scan-tdz.cjs` was itself broken and MISSED the `payments` bug; its rule was backwards
(it skipped same-function reads, which is the only case that actually throws). Repaired
and proven against the original file — it now flags lines 796/797/798.

## NOT VERIFIED — requires a real browser

Visual alignment · spacing · whether a dropdown truly renders unclipped · smooth
scrolling per tab · console errors during interaction · memory · scroll jitter ·
cross-browser CSS · print output · PDF layout · real-device touch · Firebase sync
timing · network interruption · offline behaviour.

**Highest-risk unknown:** if any ancestor of a dropdown uses CSS `transform`, `filter`
or `will-change`, `position: fixed` resolves against THAT element, not the viewport, and
the panel will land in the wrong place. Grep found none — but a grep is not a pixel.
Check this first.

## Still open (unchanged, from RELEASE_CHECKLIST)

1. **Firestore rules NOT PUBLISHED** — any signed-in staff user can delete every invoice.
2. **Owner password is a weak default** on a live public app.
3. Invoice numbering not concurrency-safe (needs server-side counter).
4. Concurrent stock oversell (needs `runTransaction`).

Note: `package.json` still says `"version": "1.0.0"`, which disagrees with the release
checklist. Left as-is — not my call to bump.
