# Phase 27 — Browser Compatibility / Viewport / Modal Integrity

**Two-stage phase.** Exercises the app across browser engines and viewport widths,
with modals / dialogs / full-screen forms at phone widths as the priority target
(modal height + on-screen keyboard + long validation text + action buttons is the
classic place a polished desktop app becomes unusable on a phone).

> ## STAGE 1 — DISCOVERY RESULT: **DEFECT FOUND**
>
> **PH27-01 (HIGH)** — the mobile (< 768 px) full-screen forms in
> `components/InventoryDashboard.js` — the shared `<MobileFormPage>` (**Receive
> Stock**, **Adjust Stock**, **Supplier**) plus the hand-rolled `asPage` branches of
> `<CheckoutModal>` (**Sell**) and `<PartModal>` (**Add / Edit Part**) — rendered
> their content in a `min-h-screen flex flex-col` block **in normal document flow**,
> on the stated assumption that *"the BODY scrolls natively"*.
>
> It does not. The application shell pins
> `html, body { position: fixed; inset: 0; overflow: hidden; height: 100dvh }`
> (`styles/globals.css`, the Phase *app-shell-fixed* hardening), so the document can
> **never** be scrolled by touch or wheel — and these branches `return` **before**
> `<main id="app-scroll">`, so there is no shell scroll container in the tree either.
> Any form taller than the visible viewport — a short phone (375 × 667), the
> on-screen keyboard open, long validation text, or a draft / refresh-safety banner —
> had its lower half **clipped below the fold with no way to reach it**.
>
> Worst case, confirmed live: **New Part on a 375 × 667 phone.** Only the *Part Name*
> field is above the fold; *SKU*, *Brand*, the **required** *Categories* field and
> *Compatible Vehicles* are all below it, and nothing scrolls. `formValid` requires a
> category, so **"Add Part" stays permanently disabled and a part cannot be
> created** on that device class.
>
> ## STAGE 2 — FIXED
>
> All three wrappers now mirror the pattern the rest of the app already uses
> (Customers / Vehicles / Billing full-screen editors, and the shared `Modal.js`):
> capped to the dynamic viewport (`h-[100dvh] flex flex-col overflow-hidden`) with
> the body in **one** real scroll region (`flex-1 min-h-0 overflow-y-auto
> dark-scroll`). Headers become non-shrinking (`flex-shrink-0`); PartModal's own
> `sticky bottom-0` Back/Next/Save bar now pins to that scroll region instead of a
> document scroll that never existed. **+42 / −17 lines (incl. comments), 1 file, no
> new component or abstraction** — `MobileFormPage` is fixed once and its 3 consumers
> inherit it.
>
> `npm test` **148/148** (+1 file) · `npm run test:rules` **2/2** (150 + 111) ·
> lint **0** · build **✓** · no `firestore.rules` change · **0 production writes**.
>
> **FINAL ASSESSMENT: PASS** (after the fix), for the surfaces actually exercised —
> see §3 for exactly which browsers those are.

---

## 1. Objective

For each browser engine and viewport width available in this environment, verify that
the shell, modals, dialogs, dropdowns, forms, tables, pagination, charts and
navigation are **usable** — content fits or scrolls, nothing is clipped, no action
button sits below the fold with no way to reach it, no horizontal page scroll, focus
and keyboard work.

## 2. Method

- Two-stage. Stage 1 was **discovery only** — no production code was modified until
  PH27-01 was confirmed live in the browser.
- Live exercise in the in-app browser pane against `next dev` in **demo mode**
  (`?demo=1`), which reads/writes `localStorage` only — **zero** production or
  Firestore data was touched.
- Structural wiring is locked by `tests/browser-viewport-integrity.test.cjs` (36
  assertions: a pure before/after scroll model + the shipped source patterns +
  parity with the modules that already handle this correctly). jsdom has no layout
  engine, so the *clip vs scroll* behaviour itself was verified by measurement in a
  real browser (`getBoundingClientRect`, `scrollHeight`/`clientHeight`, real wheel
  and drag gestures, screenshots).

## 3. Browsers & viewports ACTUALLY exercised

This is the honest matrix. There are three distinct fidelity levels and the report
does not conflate them.

| Engine | How it was exercised | Verdict basis |
|---|---|---|
| **Chromium / Chrome 148 (desktop)** | Real rendering, responsive resize @ 375 / 390 / 667 h / 768 / 1024 / 1366 / 1920 | **Directly exercised** |
| **Chrome mobile device emulation** | Android UA, `navigator.maxTouchPoints = 5`, mouse→touch translation, @ 375 × 667 and 375 × 812; real wheel + drag gestures | **Directly exercised** (device *emulation*, not a real phone) |
| **Real Android Chrome** | — | **NOT run** — not available in this environment |
| **Real iOS Safari** | — | **NOT run** — not available; iOS-specific `100dvh` / keyboard-inset / `position:fixed` quirks are **not** claimed as verified |
| **Desktop Firefox** | — | **NOT run** — Gecko not available; assessed from source only (see §12) |
| **Desktop Edge** | — | **NOT run** — but Edge 148 is the same Chromium/Blink engine as the Chrome that *was* run; treated as **equivalent-by-engine**, not separately verified |

**What this means for the fix:** PH27-01's fix uses `h-[100dvh]`, `overflow-y-auto`
and flexbox — all universally supported for ~3 years — and was verified to scroll
correctly under Chrome desktop + Chrome mobile emulation. It is the **identical
pattern** already shipping in Customers / Vehicles / Billing, which have their own
prior production verification on real devices. Real iOS Safari was **not** re-tested
this phase; the `100dvh` + keyboard-inset interaction on iOS is called out as a
residual in §13 and `KNOWN_LIMITATIONS.md`.

## 4. Application shell — PASS

| Check | 375 | 390 | 768 | 1024 | 1366 | 1920 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| No horizontal page scroll | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `body` pinned, `#app-scroll` is the only scroll owner | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Sidebar: overlay drawer < 768, fixed rail ≥ 768 (`md:pl-[280px]`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Demo banner / header are non-shrinking in-flow rows | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bottom tab bar (mobile) does not overlap content / respects safe-area | ✅ | ✅ | n/a | n/a | n/a | n/a |

`styles/globals.css` also carries: `input,select,textarea { font-size: 16px }` < 768
(kills iOS focus-zoom), `@media (pointer: coarse)` 44 px hit targets,
`env(safe-area-inset-bottom)` padding helpers, `prefers-reduced-motion` +
`html.reduce-motion`, Firefox scrollbar fallbacks (`scrollbar-width`/`scrollbar-color`
on `.dark-scroll`), and `overscroll-behavior: contain` on every inner scroller.
Viewport meta is `width=device-width, initial-scale=1, viewport-fit=cover` with **no**
`maximum-scale` / `user-scalable=no` — pinch-zoom stays available.

## 5. Modals & full-screen forms — the priority target

### 5.1 Render-path split

`useIsMobile(768)` → `(max-width: 767px)`:

| Width | Add / Edit Part · Sell · Receive · Adjust · Supplier | Everything else (Payment, Confirm, dropdowns, …) |
|---|---|---|
| **< 768** | full-screen `asPage` page (this phase's defect) | shared `Modal.js` bottom-sheet |
| **≥ 768** | shared `Modal.js` centred dialog (`sm:` variants) | shared `Modal.js` centred dialog |

`Modal.js` already caps to `visualViewport.height` / `100dvh`, owns a single
`flex-1 overflow-y-auto` body, reference-counts the body-scroll lock, closes on
Escape, and pads its footer by `env(safe-area-inset-bottom)`. **The ≥ 768 path was
never in scope of PH27-01** and was re-verified fine (New Part @ 1366 × 900: panel
`max-height: 900px`, inner scroller 1257 → 764, actions in viewport).

### 5.2 PH27-01 — before vs after (measured live)

**New Part, Step 1, 375 × 667, Chrome mobile emulation:**

| | Before fix | After fix |
|---|---|---|
| Root height | `min-h-screen` → grows to 1063 px | `h-[100dvh]` → 667 px, `overflow:hidden` |
| Scroll regions in the tree | **0** | **1** — `flex-1 min-h-0 overflow-y-auto` (content 998, viewport 603) |
| Wheel scroll (×10 ticks) | screenshot **byte-identical** — no movement | scrolls; scrollbar visible |
| Touch drag (700→150) | no movement | scrolls |
| *Categories* (required) reachable | **NO** | **YES** (scroll to `scrollTop 395`) |
| *Compatible Vehicles* reachable | **NO** | **YES** |
| "Add Part" outcome on this device | **impossible** (`formValid` false, field unreachable) | normal |

**Other affected forms (same root cause, same fix, spot-checked live):**

| Form | Fits at 375 × 667 with no banners? | Clipped when? | After fix |
|---|---|---|---|
| Sell / Checkout (`CheckoutModal` asPage) | yes (Confirm at y≈460) | offline / below-floor / error banner, **or keyboard open over the price field** → "Confirm Sale" buried | body scrolls; Confirm always reachable |
| Receive Stock (`MobileFormPage`) | yes | long supplier list / batch-cost row | body scrolls |
| Adjust Stock (`MobileFormPage`) | yes | correction-target picker + validation + "drops below reorder" warning | body scrolls |
| Supplier (`MobileFormPage`) | no — many fields | always | body scrolls |
| Add **Part** / Edit Part (`PartModal` asPage) | **no** — Step 1 already clips at 667 h | always on short phones; all phones with keyboard | body scrolls; sticky Back/Next/Save bar pins to it |

### 5.3 Why the fix is not "just let the body scroll"

The shell's `body { position: fixed; overflow: hidden }` is deliberate and load-bearing
(it kills the rubber-band that used to shift the header/sidebar on overscroll — see
`tests/app-shell-fixed.test.cjs`). Re-enabling document scroll for these pages would
regress that. The correct fix — and the one every *other* full-screen editor in the
app already uses — is a self-contained scroll region inside a viewport-capped column.

### 5.4 Modals NOT re-scoped (already correct / out of PH27-01)

Payment dialog, ConfirmDialog (archive / delete / restore), PO Receive dialog,
SearchSelect / MiniSelect dropdown panels, row-action menus, the Billing full-screen
invoice editor, Customer & Vehicle wizards — all render through `Modal.js` or the
already-hardened `h-[100dvh] flex flex-col` + `flex-1 min-h-0 overflow-y-auto` panel
pattern (`DropdownPanel`'s `ModalBoundaryContext` clamps popovers to the panel rect).
No clipping observed at 375 / 768.

## 6. Tables & pagination — PASS

| Surface | < 768 | ≥ 768 |
|---|---|---|
| Parts / Customers / Invoices / Sales / Suppliers / Job Cards / POs | tappable **card** list (`MobilePartCard` etc.) | `<table>` inside an `overflow-x: auto` wrapper (measured: 1336 px table, wrapper scrolls, no page scroll) |
| Client-side pagination controls (`.slice()` over the resident window — see Phase 25) | wrap, stay in viewport | in-row, no overflow |

No table forces a horizontal **page** scroll at any width; wide tables scroll inside
their own container only.

## 7. Charts — PASS

Reports `RptBars` / `RptDonut` (empty-guarded, Phase 24), Analytics revenue-trend /
revenue-mix, dashboard sparkline cards: all are SVG with `viewBox` + `width: 100%`,
re-render on container resize (`ResizeObserver`, guarded for absence). Resize stress
1920 → 1366 → 1024 → 768 → 390 → 375 produced no overflow, no NaN geometry, no console
error. Empty states render the guarded placeholder, not a broken axis.

## 8. Navigation & sticky/overlay layering — PASS

- Desktop sidebar: fixed full-height rail, collapse toggle, `md:pl-[280px]` /
  `md:pl-[72px]` shell padding tracks it.
- Mobile: hamburger → overlay drawer (`z-50`), backdrop dismiss, Escape closes;
  bottom tab bar (`z-[80]`) with safe-area padding.
- Z-index ladder holds: content < sidebar (50) < dropdowns/drawers (≤ 120/130) <
  ConfirmDialog < PDF preview (≤ 300) < boot splash (9998) < toaster (9999). Dropdown
  opened inside a modal stays clamped to the modal; toast over a modal stays legible
  (`maxWidth: min(420px, 100vw − 32px)`, `overflowWrap: anywhere`).

## 9. Keyboard & focus — PASS (desktop-emulation level)

`installGlobalFocusTrap()` covers all overlays. Tab cycles fields → action buttons
inside a modal without escaping to the page behind; Escape closes; Enter submits;
custom `SearchSelect`/`MiniSelect` respond to Arrow/Enter/Escape. On the fixed New
Part form, Tab traversal *did* scroll off-screen fields into view even before the fix
(browsers scroll `overflow:hidden` ancestors on focus) — but that is a keyboard-only
mitigation and does not help a touch user, which is why PH27-01 stayed HIGH.

## 10. Internationalization layout — PASS (spot check)

Hindi / Telugu long strings in nav labels, KPI cards, and modal titles wrap rather
than overflow (`t()` fallbacks + `flex-wrap` / `break-word`); no fixed-width label
containers were found that would clip a longer translation.

## 11. Console / runtime errors

Clean at every viewport, except the pre-existing **ServiceWorker registration
failure** under `next dev` (SW is not served in dev — unrelated to this phase,
disappears in the production build). No React warnings, no layout-thrash errors from
the fix.

## 12. Firefox / Gecko — source assessment only (NOT run)

No Gecko available in this environment. From source, the only Firefox-specific risks
are already handled: scrollbar styling has the `scrollbar-width` / `scrollbar-color`
fallback (`.dark-scroll`), `100dvh` is supported in Firefox ≥ 101, `:focus-visible`
and `env(safe-area-inset-*)` are supported, and there is no use of `-webkit-`-only
layout features (only `-webkit-overflow-scrolling`, which is a harmless no-op
elsewhere). **This is an assessment, not a verification.**

## 13. Residual limitations

1. **Real iOS Safari not re-tested.** `100dvh` on iOS excludes the dynamic toolbar
   until the user scrolls, and the on-screen keyboard does not resize the layout
   viewport (only `visualViewport`). The fixed scroll region means the *form* can
   always be scrolled, but on iOS the sticky footer can still sit behind the keyboard
   until the user scrolls it up. The shared `Modal.js` path measures `visualViewport`
   for exactly this reason; the `asPage` forms rely on the scroll region + the user
   scrolling. Acceptable, documented, not a regression (it was strictly worse
   before).
2. **Real Android Chrome / Firefox / Edge not run** — see §3. Edge is
   engine-equivalent to the Chrome that was run; the other two are assessed from
   source.
3. Everything in `KNOWN_LIMITATIONS.md` from prior phases still stands.

## 14. Files changed

| File | Change |
|---|---|
| `components/InventoryDashboard.js` | `MobileFormPage`, `CheckoutModal` (asPage branch), `PartModal` (asPage branch): `min-h-screen` → `h-[100dvh] flex flex-col overflow-hidden`; header → `flex-shrink-0`; body wrapped in `flex-1 min-h-0 overflow-y-auto dark-scroll`. +42 / −17. |
| `tests/browser-viewport-integrity.test.cjs` | **new** — 36 assertions (before/after scroll model, shipped patterns, cross-module parity, render-path/breakpoint, no-regression on the app-shell-fixed invariants). |
| `docs/testing/PHASE_27_BROWSER_VIEWPORT_INTEGRITY_REPORT.md` | this report |
| `docs/ROADMAP.md`, `docs/KNOWN_LIMITATIONS.md` | Phase 27 entry + iOS-Safari residual |

## 15. Gate results

```
npm test           → 148/148 test files
npm run test:rules  → 2/2  (150 + 111 assertions)
npm run lint        → exit 0  (71 pre-existing warnings: exhaustive-deps, next/image)
npm run build       → ✓  (First Load JS unchanged: 709 kB /)
firestore.rules     → unchanged
production writes   → 0
```

## 16. Final assessment

**PASS (after fix)** for the browsers and viewports listed in §3 as *directly
exercised*. One HIGH defect (PH27-01) was found in Stage 1 — a whole class of mobile
inventory forms was unusable on short phones and degraded on all phones — and fixed in
Stage 2 with the app's own established full-screen-form pattern. Firefox, Edge, real
Android and real iOS were **not** run and are not claimed as verified.
