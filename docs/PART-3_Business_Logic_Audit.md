# PART-3 — Business Logic & Financial Integrity Audit

**Project:** Balaji Auto OS · **Version at audit:** 12.3.0
**Reviewer role:** Principal ERP Architect · GST & Workshop Billing Expert · Financial Systems Auditor
**Method:** Extracted the **real shipped functions** and executed them in Node against
adversarial inputs. Every finding below is reproduced, not reasoned about.

---

## 1. What held up under attack (credit where due)

The **transaction engine is sound**. It was attacked hard and survived:

| Property | Result |
|---|---|
| Cancellation reverses **stock AND revenue** | ✅ verified |
| Cancelled invoices **excluded from GST report** | ✅ verified |
| Idempotent — double-save does not double-deduct | ✅ verified |
| Discounts clamped; negative qty/rate rejected | ✅ already present |
| Floor-price approval, zero-total block, duplicate-number guard | ✅ already present |

**The bugs were at the edges, not in the core.**

---

## 2. 🔴 CRITICAL — FIXED

### 2.1 📦 Phantom stock creation *(the worst bug in the system)*

**Root cause.** `applyStockDelta` used `Math.max(0, stock + delta)`. **Deduction was
clamped; reversal was not** — so the diff-based engine stopped being reversible the moment
stock hit the floor.

```
stock 2 → bill 5  → max(0, 2−5) = 0    ← the −3 deficit is DESTROYED
cancel  → +5      →      0 + 5  = 5    ← was 2, now 5

*** THE WORKSHOP JUST INVENTED 3 BRAKE PADS OUT OF THIN AIR ***
```

**Financial impact.** Inventory valuation overstated on the balance sheet. Parts show as
available that do not physically exist → mechanic promises a part → job card stalls.

**Fix.** Removed the clamp. **Negative stock is now the truth** — it means the shop floor
issued parts it did not have on the books, and the owner must see it to reconcile. Hiding
it corrupts inventory permanently. Logged loudly to console.
**Verified:** `2 → −3 → 2` — reversibility restored.

### 2.2 📦 No stock-availability check existed at all

You could bill **50 units with 2 in stock**. Nothing stopped it.

**Fix.** Availability gate in `save()`. Exempts estimates/drafts (quoting an unstocked part
is legitimate business), and **credits stock already committed by this invoice's own
previous version**, so editing a saved invoice does not fail against itself.

### 2.3 💰 Overpayment silently vanished

**Root cause.** No check that payments ≤ invoice total, and `balance` is
`Math.max(0, grand − paid)`.

**Impact.** Collecting **₹99,999 on a ₹1,000 invoice** showed a clean **zero balance**. The
**₹98,999 the customer is owed simply disappeared from the books.**

**Fix.** Blocked (₹1 rounding slack), plus a negative-payment block.

### 2.4 🏗 Job card billable an unlimited number of times

**Zero guard existed.** Same job card → 2 invoices = **customer double-charged, stock
double-deducted, revenue double-counted**.

**Fix.** Blocked unless the prior invoice is Cancelled/Refunded/Returned. Estimates exempt.

### 2.5 💰 GST invoice sequence was illegal (CGST Rules 2017, Rule 46(b))

`nextInvNo` stripped **all** non-digits, so `INV` / `EST` / `DRF` shared one number space:

```
existing: INV-0009, EST-0012, DRF-0020   →   next INV = INV-0021
```

Estimates and drafts were **inflating the legal tax-invoice sequence**, jumping it from
0009 straight to 0021. A GST audit reads that as **11 missing invoices**.

**Fix.** Per-prefix independent sequences. **Verified:** `INV-0009 → INV-0010`.

### 2.6 💰 Raw floats printed on tax invoices

CGST was being handed to the invoice, the PDF and the GSTR-1 export as
`29.999699999999997`. Not a legal figure. Unrounded values summed across a month make the
**filed return disagree with the books** — exactly what a GST reconciliation flags.

**Fix.** Paisa rounding at the boundary. **CGST + SGST === GST exactly** (odd paisa pushed
to CGST). Grand totals **unchanged** (₹7,080 still ₹7,080 — no behaviour drift).

---

## 3. 🔴 CRITICAL — **NOT FIXED** (cannot be fixed client-side)

### Invoice number duplication under concurrency

```
Two counters bill simultaneously, both see the same list:
  Counter A → INV-0003
  Counter B → INV-0003          *** DUPLICATE ***
```

`nextInvNo` is a **client-side max with no reservation**. The duplicate guard in `save()`
catches the collision on write — but that is a race, not a fix.

**A gap-free, collision-proof sequence requires a server-side counter** (a Firestore
transaction on a `counters/invoices` doc).

**Legal exposure:** under GST, two invoices sharing a number = defective invoice, **input
tax credit denied to your customer**, penalty exposure.

**This is the #1 v1.0 blocker.**

---

## 4. 🟠 HIGH — NOT FIXED

| Issue | Impact |
|---|---|
| **No duplicate-phone check on customers** | Same customer created twice; outstanding balance splits across two records |
| **Concurrent stock oversell** | Two terminals billing the last part both pass the availability check. Needs a Firestore transaction on the part doc. |

---

## 5. Verification

```
Engine regression (after all fixes) ........ 9/9 PASS
  unpaid idle · paid+realized · stock reduced · sales+services rows
  · vehicle history · audit · idempotent · cancel restores stock
  · cancel reverses revenue

GST / paisa rounding ....................... 10/10 PASS
  2dp on gst/cgst/sgst · cgst+sgst === gst EXACTLY · odd-paisa split
  · 100 × ₹0.07 == ₹7.00 · IGST exclusivity · exempt zeroes tax
  · grand totals unchanged

Guards installed ........................... 11/11 PRESENT
Invoice numbering (prefix isolation) ....... PASS
Undefined-identifier scanner ............... clean
Build ...................................... green
```

---

## 6. Scores

| Module | Before | After |
|---|---|---|
| Customers | 6.0 | 6.0 |
| Vehicles | 7.0 | 7.0 |
| Job Cards | 5.5 | **8.0** |
| **Billing** | **5.0** | **8.3** |
| **Payments** | **4.5** | **8.5** |
| **GST** | **4.0** | **8.0** |
| **Inventory Sync** | **3.5** | **8.5** |
| Sales Sync | 8.5 | 8.5 |
| Business Logic | 5.5 | 8.2 |
| **Financial Integrity** | **4.0** | **8.0** |
| Data Integrity | 5.0 | 8.2 |
| **Overall Part-3** | **5.0** | **8.1** |

Not 9+. The concurrency holes are real.

---

## 7. The four questions, answered honestly

**1. Would you trust this to run a real Indian workshop 10 hours a day?**
**Single-terminal — yes, now.** Multi-terminal — **no.** Two counters will eventually
duplicate an invoice number or oversell the last part.

**2. Would you deploy this Billing system into production today?**
**No.** Not because the maths is wrong — it is now correct — but because **invoice
numbering is not concurrency-safe**, and that is a *legal* exposure, not just a bug.

**3. What must be fixed before v1.0?**
1. **Server-side invoice counter** (Firestore transaction). Non-negotiable.
2. **Firestore transaction on stock decrement** — kills concurrent oversell.
3. **Duplicate-phone detection** on customers.
4. **Publish the hardened Firestore rules** (carried from Part-2).

**4. What can wait until v2.0?**
Credit/debit notes (cancellation works today) · E-invoicing / IRN (only mandatory above
₹5 crore turnover) · Multi-branch stock · Backdated-invoice locking after GST filing.

---

## ⚠️ Limit of this audit

All findings were verified by **extracting and executing the real shipped code in Node** —
not by clicking. **Please test in demo mode:** bill more than you have in stock, try
overpaying an invoice, and try billing one job card twice.
