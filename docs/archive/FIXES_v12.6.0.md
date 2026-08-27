# Balaji Auto OS — v12.6.0-rc.1 · RUNTIME POLISH SPRINT

All 9 reported issues addressed, plus 3 unreported bugs found while fixing them.
120 assertions, all executing the REAL shipped code. Build clean. Both scanners clean.

## Root causes — three were not what they looked like

**ISSUE 6/8 — "click does nothing, Enter works".** The row called scrollIntoView
whenever it became highlighted, and onMouseEnter set the highlight. So hovering
scrolled the list UNDER the pointer; the row moved between mousedown and mouseup;
the browser therefore never fired `click`. Enter worked because nothing moved.
Fixed in BOTH SearchSelect and the parts list: only follow the highlight when the
KEYBOARD drove it.

**ISSUE 7 — "scrolling randomly freezes".** ConfirmDialog hand-rolled its own
body.style.overflow lock while Modal.js owns a REFERENCE-COUNTED one. Two locks on
one <body> race: modal opens (overflow:hidden) -> confirm opens over it (captures
prev='hidden') -> confirm -> modal unmounts and unlocks (overflow:'') -> THEN the
dialog's cleanup restores prev='hidden'. Body now locked with nothing on screen;
the app stops scrolling until reload. The trigger path — Mark as Paid -> confirm ->
modal closes — is the most common flow in the app. It was never random.
Also audited: there is NO wheel/touchmove preventDefault anywhere in the codebase,
so that entire class of scroll freeze does not exist here.

**ISSUE 4 — "########".** The export was CSV, not Excel. A CSV carries no column
widths and no cell types. "########" is Excel saying "column too narrow for this
value". Not fixable in CSV — the format has nowhere to put that information.

## Unreported bugs found while fixing the above

1. **COLUMN SHIFT in the GST export.** bulkExport wrote 10 values under 9 headers.
   Every column from Date rightward was shifted one place — the "CGST" column
   actually contained SGST, "Grand Total" held total GST. Anyone filing GST from
   that sheet filed wrong numbers. writeSheet() now THROWS on a length mismatch.

2. **Money exported as TEXT.** Every CSV quoted every value, so =SUM() over a stock
   valuation or "Total Spent" returned 0. A valuation you cannot total is not a
   valuation. Numbers now stay numeric.

3. **Vehicles export had the same ######## bug** (Insurance Expiry / PUC Expiry) —
   the two columns a workshop actually sorts by. Never reported.

## Issues

1. Settings dirty state — `dirty` compared raw JSON, but every toggle reads as
   `biz[k] !== false`, so an ABSENT key means TRUE. Saved settings are {}; toggling
   off then on left {remLowStock:true}. Same settings, different JSON, Save stuck
   lit forever. Now normalised through a defaults table with sorted keys. A test
   asserts the defaults stay in sync with the accessors.
2. Settings sidebar — NOTHING WAS DISABLED. "Preferences"/"Administration" are group
   HEADERS that read as greyed-out dead items. Marked as labels, not buttons.
3. Vehicle dashboard — the revenue card wrapped MID-NUMBER ("₹71,35,2 / 5,92 / 0").
   No whitespace-nowrap, plus 11 cards squeezed into 6 columns. Now 5 columns,
   nowrap + tabular-nums, compact ₹71.35 Cr with the exact figure on hover.
4. Excel export — real .xlsx, date cells (dd-mmm-yyyy), sized columns. ALL 6 exports.
5. Customer dropdown — no longer opens on focus. Opens on click or typing.
6. Part search — mouse click now selects, identically to Enter.
7. Global scrolling — one reference-counted body lock; a test FAILS the build if any
   file other than Modal.js writes document.body.style.
8. Global dropdowns — all 11 hand-rolled panels portal through DropdownPanel.
9. Polish — busy/disabled state on every export, focus rings, aria-pressed,
   dropdown entry animation that respects prefers-reduced-motion.

## Verification (executing real code — there is NO browser in that environment)

    next build                    ✓ compiled successfully
    scan-undef.cjs                4 findings, all false positives (CSS/self/caches)
    scan-tdz.cjs                  0
    tests/regression.test.cjs    46/46
    tests/export.test.cjs        15/15
    tests/dropdowns.test.cjs     14/14
    tests/settings-dirty         14/14
    tests/statcards.test.cjs     14/14
    tests/scrolllock.test.cjs    10/10
    tests/overpayment.test.cjs    7/7

Guards that FAIL THE BUILD on regression:
  * any dropdown reverting to absolute positioning
  * any silent .slice() cap on a search result list
  * any component writing document.body.style (a second, racing scroll lock)
  * any raw CSV blob
  * a misaligned export sheet (column shift)
  * a `biz.x !== false` accessor with no registered default

## NOT VERIFIED — needs a real browser

Pixel alignment. Animation smoothness. Whether a dropdown truly renders unclipped.
Print/PDF layout. Real-device touch. Memory. Cross-browser CSS. Scroll feel.

The ######## fix is verified by WRITING a real .xlsx and READING THE CELLS BACK —
not by opening it in Excel. Please open it in Excel.

Highest-risk unknown: if any ancestor of a dropdown uses CSS transform / filter /
will-change, position:fixed resolves against THAT element, not the viewport, and the
panel lands in the wrong place. Grep found none. A grep is not a pixel.

## Deferred to v2 (honestly)

* Modal entry animation, sticky-header polish, table-scroll feel. Pure visual work.
  I could write plausible code and no test would tell either of us whether it helped.
* Vehicle dashboard GROUPING (splitting 11 cards into primary/secondary tiers). The
  wrapping/truncation defects are fixed; the information-hierarchy question is a
  design decision that needs a human eye on a rendered page.

## STILL OPEN — NOT CODE, AND BIGGER THAN ANYTHING IN THIS RELEASE

1. **Firestore rules are NOT PUBLISHED.** Any signed-in staff user can delete every
   invoice. firestore.rules is correct in the repo; it must be pasted into the
   Firebase console.
2. **The owner password is a weak default** on a live public app.
3. Invoice numbering is not concurrency-safe (needs a server-side counter).
4. Concurrent stock oversell (needs runTransaction).

Six rounds of fixes are polish on an application whose database is currently open to
anyone who signs in. Do 1 and 2 before you ship this.
