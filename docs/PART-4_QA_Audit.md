# PART-4 — Enterprise QA & Production Validation Audit

**Project:** Balaji Auto OS · **Version at audit:** 12.3.0
**Reviewer role:** Principal QA Architect · Release Manager · ERP Product Quality Lead
**Scope:** Quality · UX · Production Stability · Runtime Risk
**Authority:** This review can block a release.

---

## 1. What passed inspection (genuinely good)

The classic production killers were hunted for and **not found**:

| Check | Result |
|---|---|
| **Memory leaks** | **None.** 116 `useEffect`s scanned. All 15 Firestore listeners, window events and intervals return cleanup. The 3 flagged were **false positives** (one-shot `setTimeout` / `requestAnimationFrame` / mount-once SW registration). |
| **Pagination** | **Present.** `page` state in Inventory, Customers, Billing + 3 other views. The "10,000 DOM nodes" hypothesis was **wrong** — it was checked, not reported. |
| **Error boundary** | Exists and is wired in `_app.js`. |
| **Destructive actions** | Confirmed across all 5 modules. |
| **UX affordances** | 26 empty states · 85 error toasts · 60 success toasts. |

---

## 2. 🔴 CRITICAL — FIXED

### 2.1 🧪 The cloud migration was lying to users

**Root cause.** Three defects that combined catastrophically:

1. `setDoc()` is **async and was never awaited** → the wrapping `try/catch` caught nothing;
   rejections surfaced later as unhandled promise rejections.
2. `migrated++` counted **attempts, not successes**.
3. `maruti_fs_migrated_v1` was set **unconditionally**.

**Production impact.** A workshop's entire customer + invoice history fails to upload →
the app cheerfully toasts **"Synced 300 records to the cloud"** → the flag is set → **the
migration never retries**. The owner believes their data is safely backed up. It is
stranded on one browser. **One cleared cache = total, unrecoverable loss.**

**Fix.** `Promise.allSettled` on the real writes · count only *fulfilled* · **only set the
flag if zero failures** · tell the user honestly if some did not sync, and retry next load.

**Files:** `components/InventoryDashboard.js`
**Regression risk:** Low · **Runtime verification required: YES**

### 2.2 ♿✨ Destructive dialogs defaulted to DESTROY

**Root cause.** `autoFocus` sat **unconditionally on the confirm button**.

**Impact.** On *"Delete this invoice?"*, a user pressing **Enter out of habit** — without
reading the message — **deleted it**.

**Fix.** `autoFocus={danger ? cancel : confirm}` — the **safe action holds focus** on
destructive dialogs. Also added **body scroll lock**: the page scrolled behind the modal on
mobile, so **the confirm button moved as you reached for it**.

**Verified in jsdom — 7/7 PASS:**
```
danger focuses CANCEL ............ PASS
body scroll locked / released .... PASS
Enter on default => CANCEL ....... PASS
role=alertdialog / aria-modal .... PASS
non-danger focuses CONFIRM ....... PASS
Escape dismisses ................. PASS
clicking Delete still confirms ... PASS
```

---

## 3. 🟠 HIGH — NOT FIXED (deliberate)

### 3.1 25 hand-rolled modals with no focus trap

```
role="dialog"        0 of 25
focus trap           0 of 25
body scroll lock     0 of 25  (now 1 — ConfirmDialog)
Escape handling      3 of 25
```

**Tab escapes the dialog into the page behind it.** `ConfirmDialog` — the one guarding
deletes — is correct (`role="alertdialog"`, `aria-modal`, Escape, safe-default focus). The
other 25 are not.

Fixing all 25 is a **systematic pass, not a patch**, and touching 25 overlays risks visual
regression that **cannot be seen without a browser**. → **v1.0 blocker for accessibility
compliance; not a data-integrity risk.**

### 3.2 33 silent `catch {}` on persistence

Most are benign (UI preferences — a failed theme read should not raise an error toast), but
~10 swallow draft/demo saves. Lower priority than the migration, which is now fixed.

---

## 4. Requires Runtime Verification (NOT scored)

These **cannot be proven from code** and are explicitly **not** reported as pass or fail:

- Responsive behaviour (desktop / laptop / tablet / mobile)
- Print & PDF: page breaks, headers/footers, multi-page long invoices
- Touch target sizes on the shop floor
- Real screen-reader output
- QR code scanning with a physical phone

---

## 5. Scores

| Area | Score |
|---|---|
| Dashboard / Customers / Vehicles / Suppliers / Sales | 8.5 |
| Job Cards / Inventory / Reports / Analytics | 8.3 |
| Billing | 8.5 |
| Alerts / Reminders / Settings | 8.0 |
| UI Consistency | 8.5 |
| UX | 8.3 |
| **Performance** | **8.5** |
| **Accessibility** | **6.0** ← focus traps |
| Responsive Implementation | *Requires Runtime Verification* |
| Export & Print | *Requires Runtime Verification* |
| **Error Handling** | 7.5 → **8.5** |
| **Production Stability** | **8.4** |
| **Overall Part-4** | **8.2** |

---

## 6. Release decision

**1. Approve this build for production?**
**Conditionally yes** — for **single-terminal** workshops, *after* runtime verification. The
migration bug alone justified this review; it would have been a **catastrophic silent
data-loss event**.

**2. Remaining release blockers**
- 🔴 Modal focus traps (25 dialogs)
- 🔴 *(Part-3)* Server-side invoice counter
- 🔴 *(Part-2)* **Publish the hardened Firestore rules**

**3. Must fix before v1.0**
1. Focus traps on the 25 modals
2. **Test the migration on a real device with real data** — it was fixed blind
3. Verify print/PDF page breaks on a long invoice

**4. Safe for v2.0**
Table virtualization (pagination is sufficient) · skeleton loaders (only 3 exist) · bulk
actions · column resizing

**5. Production readiness: ~82%**

---

## ⚠️ The honest limit of this review

**There is no browser.** Responsive layout, print/PDF pagination, touch targets and real
screen-reader output are all marked **Requires Runtime Verification** and will **not** be
reported as passing from code alone.

**Verify by hand:**
1. Open a modal and press Tab repeatedly — does focus escape?
2. Print a 100-line invoice.
3. **Most importantly: test the cloud migration with real data on a real device** — that fix
   protects the one thing a workshop can never get back.
