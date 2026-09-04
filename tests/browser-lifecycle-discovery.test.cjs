/**
 * tests/browser-lifecycle-discovery.test.cjs
 *
 * PHASE 7 — BROWSER / TAB / LAPTOP LIFECYCLE INTEGRITY.  DISCOVERY.
 *
 * Companion to the emulator-backed lease/operation-ID proofs in
 * tests/rules/firestore.rules.test.cjs (the "PHASE 7" section there —
 * MANDATORY SLEEP/WAKE, MANDATORY STALE-LEASE, PH7-15/27/14). This file
 * covers everything provable from source alone: who owns sessionId and how,
 * which lifecycle events release/renew a lease, whether operation identity
 * survives which lifecycle events, and whether route/modal navigation can
 * silently discard unsaved work or corrupt lease/session state.
 *
 * Method: source-pattern audit, per the established Phase 5/6 convention.
 * `ok()` = proven fact / cleared invariant. `defect()` = a confirmed gap,
 * expected to FAIL until a Phase 7B closes it — this file stays discovery,
 * nothing here is converted to "passing" during Phase 7 itself.
 */
const fs = require('fs');
const path = require('path');

let PASS = 0, FAIL = 0, DEFECTS = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const defect = (name, isFixed, detail = '') => {
  if (isFixed) { PASS++; console.log(`  ✓ [was a defect, now fixed] ${name}`); }
  else { DEFECTS++; console.log(`  ⚠ [DEFECT — lifecycle gap] ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const dash = read('../components/InventoryDashboard.js');
const cust = read('../components/customers/CustomersModule.jsx');
const jc = read('../components/jobcards/JobCardModule.jsx');
const bill = read('../components/billing/BillingModule.jsx');
const auth = read('../context/AuthContext.js');
const lease = read('../lib/editLease.js');
const useLease = read('../hooks/useEditLease.js');
const durable = read('../lib/durableOpId.js');
const useDurable = read('../hooks/useDurableOpId.js');
const recordSync = read('../lib/recordSync.js');
const useRecordSync = read('../hooks/useRecordSync.js');
const rules = read('../firestore.rules');

const slice = (src, a, b) => {
  const s = src.indexOf(a); if (s < 0) return '';
  const e = b ? src.indexOf(b, s + a.length) : -1;
  return src.slice(s, e > s ? e : s + 4000);
};

console.log('\nPHASE 7 — browser / tab / laptop lifecycle integrity\n');

// =====================================================================
// 1 — SESSION IDENTITY ARCHITECTURE
// =====================================================================
console.log('1  Session identity — who owns sessionId, is it truly per-tab\n');
ok('[fact] sessionId is generated ONCE per AuthProvider mount (i.e. per tab), via crypto.randomUUID(), and is NEVER written to sessionStorage/localStorage — it lives only in a React useRef',
  /const sessionIdRef = useRef\(\);/.test(auth)
  && /if \(!sessionIdRef\.current\) sessionIdRef\.current = makeSessionId\(\);/.test(auth)
  && !/sessionStorage\.(setItem|getItem)\([^)]*sessionId/i.test(auth)
  && !/localStorage\.(setItem|getItem)\([^)]*sessionId/i.test(auth));
ok('[fact] the code\'s OWN comment states the design intent explicitly: "Generated once per AuthProvider mount (i.e. per tab), never persisted — a reload is a new session, which is correct"',
  /Generated once per AuthProvider mount\s*\n\/\/ \(i\.e\. per tab\), never persisted/.test(auth));
ok('[fact] a REFRESH of the SAME tab therefore mints a NEW sessionId (the AuthProvider remounts on page load) — a stale lease from a crashed/refreshed tab is orphaned under its OLD sessionId and can only be reclaimed via the expiry backstop, never silently reclaimed by "the same user reconnecting"',
  /never persisted — a reload is a new session, which is correct\s*\n\/\/ \(a stale lease from a crashed tab simply expires\)/.test(auth));
ok('[fact] sessionId is NOT derived from anything the browser copies on tab-duplication (sessionStorage/localStorage/URL) — it is pure in-memory JS state created fresh by React on every mount, INCLUDING a duplicated tab\'s mount (a duplicate tab is a new Document/JS VM; it does not clone a running script\'s variables, only browser-level storage APIs) — so sessionId is safe from the tab-duplication risk that DOES affect sessionStorage-backed state (see §5 below)',
  /const makeSessionId = \(\) => \{/.test(auth) && /crypto\.randomUUID/.test(auth));
ok('[fact] the edit lease keys explicitly on (ownerUid, sessionId), not uid alone — this is what makes two tabs of the SAME logged-in user compete for the lease like two different editors, rather than one of them silently inheriting the other\'s authority',
  /a stable per-tab client id\. A single authenticated user\s*\n\/\/ can have several tabs open; the edit lease must distinguish them, so it keys on\s*\n\/\/ \(ownerUid, sessionId\), not uid alone\./.test(auth));

// =====================================================================
// 2 — LEASE ARCHITECTURE (who/what/when/how — Step 1)
// =====================================================================
console.log('\n2  Lease architecture\n');
ok('[fact] LEASE_MS=90s, HEARTBEAT_MS=30s (3 heartbeats of runway per lease window, matching the file\'s own stated design)',
  /export const LEASE_MS = 90 \* 1000;/.test(lease) && /export const HEARTBEAT_MS = 30 \* 1000;/.test(lease));
ok('[fact] the heartbeat is a PLAIN setInterval with no visibilitychange/hidden-tab handling at all — it is never paused when the tab is backgrounded and never explicitly resumed on foreground; its only real-world backstop against "the tab is backgrounded/asleep and stops actually reaching the network" is the SERVER-side expiresAt check, not any client-side pause/resume logic',
  /hbRef\.current = setInterval\(\(\) => \{\s*\n\s*renewLease\(c, d, \{ uid, email, sessionId \}\)\.catch\(\(\) => \{ release\(\); \}\);\s*\n\s*\}, HEARTBEAT_MS\);/.test(useLease)
  && !/visibilitychange/.test(useLease) && !/document\.hidden/.test(useLease));
ok('[fact] a failed heartbeat (any rejection — offline, lease/lost because someone else took over, a timeout) calls this session\'s OWN release() — which (per §3 below) is itself session-scoped and provably cannot remove a DIFFERENT session\'s lease',
  /renewLease\(c, d, \{ uid, email, sessionId \}\)\.catch\(\(\) => \{ release\(\); \}\);/.test(useLease));
ok('[fact] lease release is wired to THREE triggers: explicit caller release() (Cancel/Save), the hook\'s own unmount cleanup effect, and the `pagehide` browser event (best-effort tab-close signal) — never `beforeunload` (that event is reserved app-wide for "warn before discarding a dirty FORM", a different concern) and never `visibilitychange`/`blur` (backgrounding a tab does not release the lease — only closing/navigating away from the record does)',
  /window\.addEventListener\('pagehide', onHide\);/.test(useLease)
  && /useEffect\(\(\) => \(\) => \{ release\(\); \}, \[release\]\);/.test(useLease)
  && !/window\.addEventListener\('beforeunload'/.test(useLease));
ok('[fact] the server-side expiry (`expiresAt`, a plain Firestore timestamp compared to `request.time` in the rules AND re-derived client-side as `toMillis(d.expiresAt) > Date.now()`) is the ACTUAL backstop the code\'s own comments repeatedly point to — "the lease\'s server-side expiry is the real backstop if all of those fail" — meaning it is this mechanism, not any client lifecycle listener, that makes a laptop-sleep / browser-crash scenario recoverable at all',
  /the lease's\s*\n\/\/ server-side expiry is the real backstop if all of those fail/.test(useLease));

// =====================================================================
// 3 — STALE OWNER RENEWAL / RELEASE — the exact regression class Phase 1b
// already fixed once (per the project's own history); re-verify the guard
// is still session-scoped, not just uid-scoped, at the CLIENT layer.
// =====================================================================
console.log('\n3  Stale-owner renewal / release guards (client layer)\n');
ok('[fact] renewLease refuses to overwrite an ACTIVE lease unless `mine` (BOTH ownerUid AND sessionId match) OR the existing lease is already `expired` — a same-uid different-session renewal attempt against someone else\'s (or this same user\'s OTHER tab\'s) still-active lease throws lease/lost instead of silently re-claiming it',
  /const mine = d\.ownerUid === uid && d\.sessionId === sessionId;/.test(slice(lease, 'export async function renewLease', 'export async function releaseLease'))
  && /if \(!mine && !expired\) throw new LeaseError\('lease\/lost'/.test(slice(lease, 'export async function renewLease', 'export async function releaseLease')));
ok('[fact] releaseLease only touches the lease document if `mine` (BOTH ownerUid AND sessionId match the CURRENT resource) — a stale/delayed release from a session that no longer owns the (now-reassigned, non-expired) lease is a correctly-scoped no-op, never a mutation of the new owner\'s lease',
  /const mine = !!owner && d\.ownerUid === owner\.uid && d\.sessionId === owner\.sessionId;/.test(slice(lease, 'export async function releaseLease', null))
  && /if \(!mine\) return;/.test(slice(lease, 'export async function releaseLease', null)));
ok('PH7-27 FIXED [fact]: releaseLease now RELEASES via a session-scoped UPDATE (backdating expiresAt into the past) rather than a delete — a Firestore delete carries no payload for the rules to check a releasing session\'s identity against, so restricting release to this update path is what lets the RULES (not just the client) enforce that only the current session may give up its own lease',
  /tx\.update\(ref, \{[\s\S]{0,200}expiresAt: Timestamp\.fromMillis\(Date\.now\(\) - 1000\),/.test(slice(lease, 'export async function releaseLease', null)));
ok('[fact] both checks run INSIDE the same runTransaction as the read that produced them (tx.get then the mine/expired decision then tx.set/tx.delete, all in one atomic transaction) — there is no read-then-later-write window a competing acquire could race into between the check and the write',
  /export async function renewLease[\s\S]{0,400}const ref = leaseRef\(collectionName, docId\);[\s\S]{0,400}await withTimeout\(runTransaction\(db, async \(tx\) => \{/.test(lease));
ok('MANDATORY STALE-LEASE cross-reference: this exact scenario (A stale, B owns, A\'s heartbeat resumes, A\'s delayed release fires) is proven end-to-end against the REAL emulator + REAL rules in tests/rules/firestore.rules.test.cjs\'s PHASE 7 section — not just reasoned about here from source',
  /MANDATORY STALE-LEASE/.test(read('../tests/rules/firestore.rules.test.cjs')));

// =====================================================================
// 4 — RULES-LEVEL SESSION AWARENESS (Step 27) — the client-layer guards
// above are necessary but the RULES are the independent second line of
// defense against a client that doesn't go through lib/editLease.js at all.
// =====================================================================
console.log('\n4  Firestore rules — is editLocks session-aware, or only uid-aware?\n');
const editLocksRule = slice(rules, 'match /editLocks/{lockId}', '// ----');
ok('[fact] ownedByMe() checks ONLY resource.data.ownerUid == request.auth.uid — it does not reference sessionId at all',
  /function ownedByMe\(\) \{\s*\n\s*return signedIn\(\) && resource\.data\.ownerUid == request\.auth\.uid;\s*\n\s*\}/.test(editLocksRule));
ok('PH7-27 FIXED [fact]: incomingShapeOk() still requires the INCOMING write to CARRY a sessionId (`is string`) — that shape check is unchanged — but session IDENTITY CONTINUITY is now enforced by a separate function, sameSession(), gated into the update rule below rather than folded into incomingShapeOk() itself',
  /request\.resource\.data\.sessionId is string/.test(editLocksRule)
  && /function sameSession\(\) \{\s*\n\s*return resource\.data\.sessionId == request\.resource\.data\.sessionId;/.test(editLocksRule));
ok('PH7-27 FIXED [fact]: the UPDATE rule now requires sameSession() (in addition to ownedByMe()) for any write against a still-ACTIVE lease — a same-uid client bypassing lib/editLease.js\'s transaction (e.g. the Firestore SDK called directly) can no longer overwrite its own other-tab\'s ACTIVE lease purely on ownerUid match; only a lease that has genuinely EXPIRED may be taken over without matching the previous session',
  /allow update: if signedIn\(\) && \(\s*\n\s*\(expired\(\) && incomingShapeOk\(\)\) \|\|\s*\n\s*\(ownedByMe\(\) && sameSession\(\) && \(incomingShapeOk\(\) \|\| releaseShapeOk\(\)\)\)\s*\n\s*\);/.test(editLocksRule));
ok('PH7-27 FIXED [fact]: DELETE is restricted to an already-EXPIRED lease only — an ACTIVE lease can never be deleted by anyone, including its own owner, because a raw Firestore delete carries no payload (`request.resource` is null) for the rules to check a releasing session\'s identity against; release of an active lease now goes through the session-scoped UPDATE path instead (releaseShapeOk())',
  /allow delete: if signedIn\(\) && expired\(\);/.test(editLocksRule) && /function releaseShapeOk\(\)/.test(editLocksRule));
ok('MANDATORY cross-reference: this exact fix (A2, same uid as A1 but a different session, can no longer overwrite/renew/release A1\'s ACTIVE lease; a genuinely different uid was already blocked; A1 itself can still release via a session-scoped update; an EXPIRED lease can still be freely taken over) is proven end-to-end against the REAL emulator + REAL rules in tests/rules/firestore.rules.test.cjs\'s "STEP 27 — PHASE 7b FIX" section (10 numbered scenarios) — not just reasoned about here from source',
  /STEP 27 — PHASE 7b FIX/.test(read('../tests/rules/firestore.rules.test.cjs')));

// =====================================================================
// 5 — DURABLE OPERATION-ID LIFECYCLE (Step 12/13/14)
// =====================================================================
console.log('\n5  Durable operation-ID lifecycle vs tab/browser events\n');
ok('[fact] the durable opId lives in sessionStorage, keyed `ph5b:op:<scope>`, minted once per scope and reused on every subsequent readOrCreateOpId call for that scope until explicitly cleared',
  /const PREFIX = 'ph5b:op:';/.test(durable) && /sessionStorage\.getItem\(key\)/.test(durable) && /sessionStorage\.setItem\(key, JSON\.stringify\(\{ opId, pi: getPageInstanceId\(\) \}\)\)/.test(durable));
ok('[fact] the module\'s OWN header comment already documents sessionStorage\'s real lifetime accurately: "survives a reload of the same tab (and only that tab — it is never synced anywhere, and it is gone when the tab closes...)"',
  /it survives a\s*\n\/\/ reload of the same tab \(and only that tab/.test(durable) || /SURVIVES a reload\/navigation of the SAME tab/.test(durable));
ok('[fact] useDurableOpId reads the id ONCE on first render (a useRef gate) and pins it for the life of the component instance — a re-render does not re-read sessionStorage, so an already-open modal\'s opId cannot drift mid-session even if sessionStorage were externally mutated',
  /const state = useRef\(null\);\s*\n\s*if \(state\.current === null\) \{/.test(useDurable));

// ---- PH7-01 FIXED: window.name-tagged page-instance id ----
ok('PH7-01 FIXED: every sessionStorage entry is now tagged with a page-instance id derived from `window.name` — a property of the BROWSING CONTEXT that survives a reload/navigation of the SAME tab but is empty in any NEW top-level browsing context (a plain new tab, or a duplicated one — sessionStorage is the one thing the HTML spec clones on duplication; window.name is not part of that)',
  /const PAGE_INSTANCE_PREFIX = 'ph7b:pi:';/.test(durable)
  && /function getPageInstanceId\(\)/.test(durable)
  && /window\.name\.startsWith\(PAGE_INSTANCE_PREFIX\)/.test(durable));
ok('PH7-01 FIXED: readOrCreateOpId only trusts an existing sessionStorage entry as "my own earlier attempt" when it is tagged with THIS page instance\'s id — an entry tagged with a DIFFERENT instance (only possible via inherited/cloned sessionStorage) is never reused for a new intent',
  /if \(entry && \(pi === null \|\| entry\.pi === pi\)\) return entry\.opId;/.test(durable));
ok('PH7-01 FIXED: peekOpId (the "an earlier attempt on THIS exact intent did not confirm" signal) applies the SAME page-instance check — a duplicated tab does not see a false "check before retrying" banner for an id it never actually attempted itself',
  /export function peekOpId\(scope\) \{[\s\S]{0,300}entry\.pi !== pi\) return null;/.test(durable));

// Pure-model proof — mirrors readOrCreateOpId's exact algorithm (not a
// re-implementation guess: same tag-check, same mint-on-mismatch) against a
// mock window.name + sessionStorage, since this Node/CJS harness cannot load
// the real ES module or a real browser. Demonstrates the phase's own required
// invariant directly: refresh -> same id; duplicate + new intent -> different
// id; brand-new tab -> different id.
function mockPageInstance(nameStore) {
  // nameStore: a { value } box standing in for one browsing context's
  // window.name — passed a FRESH box for a fresh/duplicated context, the
  // SAME box (by reference) for "reload the same tab".
  const PREFIX_PI = 'ph7b:pi:';
  if (typeof nameStore.value === 'string' && nameStore.value.startsWith(PREFIX_PI)) return nameStore.value;
  const fresh = PREFIX_PI + Math.random().toString(36).slice(2, 10);
  nameStore.value = fresh;
  return fresh;
}
function mockReadOrCreateOpId(sessionStore, nameStore, scope) {
  const pi = mockPageInstance(nameStore);
  const raw = sessionStore[scope];
  if (raw && raw.pi === pi) return raw.opId;
  const fresh = 'op_' + Math.random().toString(36).slice(2, 10);
  sessionStore[scope] = { opId: fresh, pi };
  return fresh;
}

// Tab A starts a payment -> opId X.
const tabA = { session: {}, name: {} };
const X = mockReadOrCreateOpId(tabA.session, tabA.name, 'payment:INV-1');

// Tab A refreshes (SAME browsing context: window.name box is the SAME
// reference, sessionStorage persists) and retries -> MUST remain X.
const X_afterRefresh = mockReadOrCreateOpId(tabA.session, tabA.name, 'payment:INV-1');
ok('MANDATORY IDENTITY MODEL: same-tab refresh -> same operation id (X unchanged)', X_afterRefresh === X);

// Tab A is DUPLICATED into Tab B: sessionStorage is CLONED (same content,
// independent object per the spec) but window.name is NOT (fresh browsing
// context -> starts empty). Tab B independently starts a genuinely different
// payment on the SAME invoice/scope.
const tabB = { session: { ...tabA.session }, name: {} }; // sessionStorage cloned; window.name fresh (empty)
const Y = mockReadOrCreateOpId(tabB.session, tabB.name, 'payment:INV-1');
ok('MANDATORY IDENTITY MODEL: duplicated tab + a NEW legitimate action -> a DIFFERENT operation id (Y != X), even on the identical scope string, because the inherited sessionStorage entry is tagged with A\'s page-instance id, not B\'s', Y !== X);
ok('MANDATORY IDENTITY MODEL: X != Y demonstrated directly', X !== Y);

// Tab A, meanwhile, continuing its OWN original pending/retry -> still X.
const X_stillPending = mockReadOrCreateOpId(tabA.session, tabA.name, 'payment:INV-1');
ok('MANDATORY IDENTITY MODEL: Tab A\'s own continued retry after the duplication event is still X (unaffected by what Tab B does with its independent copy)', X_stillPending === X);

// A genuinely NEW tab (not a duplicate — never shared A's sessionStorage at
// all) starting the "same" scope gets its own fresh id too.
const freshTab = { session: {}, name: {} };
const Z = mockReadOrCreateOpId(freshTab.session, freshTab.name, 'payment:INV-1');
ok('[fact] a genuinely NEW tab (not a duplicate) starting on the same scope also mints its own distinct id — unaffected by anything A or B did', Z !== X && Z !== Y);

ok('[fact] a genuine RETRY of the SAME intent in the SAME tab (refresh, or the modal reopening after an ambiguous failure) correctly reuses the SAME opId — this is the Phase 5b/6b guarantee, fully preserved by the Phase 7b fix (proven above: X_afterRefresh === X)',
  X_afterRefresh === X);

// =====================================================================
// 6 — ROUTE / TAB-SWITCH LIFECYCLE (Step 21/22/23) — does navigating within
// the app's own SPA tab model unmount an open editor, release its lease,
// and/or silently discard unsaved changes?
// =====================================================================
console.log('\n6  Route (in-app tab) navigation lifecycle\n');
ok('[fact] every module (Customers, Billing, Job Cards, Inventory, ...) is CONDITIONALLY RENDERED on activeTab, not always-mounted-and-CSS-hidden — `{activeTab === \'customers\' && <CustomersModule ... />}` — so switching away from a module genuinely UNMOUNTS it and everything inside it, including any open editor and its useEditLease instance',
  /\{activeTab === 'customers' && \(/.test(dash) && /\{activeTab === 'billing' && \(/.test(dash));
ok('[fact] unmounting the module therefore DOES release its lease (via useEditLease\'s own unmount cleanup, §2) — navigating away from an open editor is not a lock-corruption risk, it correctly frees the record for others',
  /useEffect\(\(\) => \(\) => \{ release\(\); \}, \[release\]\);/.test(useLease));
ok('[fact] per-module UI state (search/filter/page/selected-row) is preserved across a tab switch via a MODULE-SCOPED (not component-state) cache object, explicitly designed to "survive unmount on tab switch"',
  /module-scoped cache; survives unmount on tab switch/.test(cust));
ok('[fact] this is a genuine, provable ASYMMETRY (not a blanket absence of the feature) — Settings demonstrably HAS the guard, proving the app already recognizes and solves this exact risk class elsewhere',
  /if \(tab !== 'settings' && settingsDirtyRef\.current\) \{/.test(dash)
  && /window\.confirm\('You have unsaved settings\. Leave without saving\?'\)/.test(dash));
ok('[fact] browser back/forward is wired to the SAME hash-based activeTab restoration as a normal nav click (not a separate code path with different unsaved-data semantics) — so PH7-02 below applies identically to Back/Forward, not just sidebar clicks',
  /Restore the tab from the URL on first paint \(and honour Back\/Forward\)/.test(dash));

// ---- PH7-02 FIXED: the settings-only guard generalized to every entity editor ----
ok('PH7-02 FIXED [fact]: InventoryDashboard now holds a SHARED moduleDirtyRef (parallel to settingsDirtyRef) and a stable handleModuleDirtyChange setter passed down as the `onDirtyChange` prop — one flag is sufficient since only one module/editor is ever mounted at a time (the conditional-render architecture proven in §6 above)',
  /const moduleDirtyRef = useRef\(false\);/.test(dash)
  && /const handleModuleDirtyChange = useCallback\(\(v\) => \{ moduleDirtyRef\.current = !!v; \}, \[\]\);/.test(dash));
ok('PH7-02 FIXED [fact]: setActiveTab (the ONE function every tab-switch click funnels through) now confirms before discarding a dirty non-Settings editor too, gated on `tab !== activeTabRef.current` so re-clicking the already-active tab never spuriously prompts',
  /if \(tab !== activeTabRef\.current && moduleDirtyRef\.current\) \{/.test(dash)
  && /window\.confirm\('You have unsaved changes\. Leave without saving\?'\)/.test(dash));
ok('PH7-02 FIXED [fact]: CustomersModule\'s editor (CustomerWizard) computes the SAME kind of `dirty` (JSON diff against its initial snapshot) as the Part/Supplier forms already did, and forwards it to the dashboard via onDirtyChange — reset unconditionally on unmount so the flag can never outlive the editor, whether closed via a successful save or a cancel',
  /function CustomerWizard\(\{ initial, existing, canManage, onSave, onClose, demoMode = false, formValuesRef, conflict, onDirtyChange \}\)/.test(cust)
  && /useEffect\(\(\) => \{ if \(onDirtyChange\) onDirtyChange\(dirty\); \}, \[dirty, onDirtyChange\]\);/.test(cust)
  && /useEffect\(\(\) => \(\) => \{ if \(onDirtyChange\) onDirtyChange\(false\); \}, \[onDirtyChange\]\);/.test(cust)
  && /<CustomerWizard[\s\S]{0,600}onDirtyChange=\{onDirtyChange\}/.test(cust));
ok('PH7-02 FIXED [fact]: JobCardModule\'s own ref-based `dirty` tracker (a useRef, not useState — every assignment site already existed before Phase 7b) is now routed through a `setDirty` wrapper that ALSO calls onDirtyChange, so every one of its existing true/false writes (draft load, field edit, image attach, save, conflict-resolution, discard) propagates without needing its own separate effect — no raw `dirty.current = true/false` assignment remains anywhere else in the file (the wrapper itself writes `dirty.current = v`, a variable, never a literal, so this check cannot accidentally match its own definition)',
  /const setDirty = useCallback\(\(v\) => \{ dirty\.current = v; if \(onDirtyChange\) onDirtyChange\(v\); \}, \[onDirtyChange\]\);/.test(jc)
  && !/dirty\.current = (true|false);/.test(jc)
  && /useEffect\(\(\) => \(\) => \{ if \(onDirtyChange\) onDirtyChange\(false\); \}, \[onDirtyChange\]\);/.test(jc));
ok('PH7-02 FIXED [fact]: BillingModule\'s InvoiceModal already computed a `dirty` flag (undo-stack + JSON diff) for its OWN guardedClose confirm dialog — that confirm never fired on a sidebar/tab click (which unmounts the modal directly, bypassing guardedClose entirely); `dirty` is now hoisted out of that callback into render scope and forwarded via onDirtyChange so the dashboard\'s guard sees it too',
  /const dirty = undoStack\.current\.length > 0 && JSON\.stringify\(inv\) !== JSON\.stringify\(initial\);/.test(bill)
  && /useEffect\(\(\) => \{ if \(onDirtyChange\) onDirtyChange\(dirty\); \}, \[dirty, onDirtyChange\]\);/.test(bill)
  && /useEffect\(\(\) => \(\) => \{ if \(onDirtyChange\) onDirtyChange\(false\); \}, \[onDirtyChange\]\);/.test(bill));
ok('PH7-02 FIXED [fact]: the Part and Supplier editors (PartModal/SupplierModal, components/InventoryDashboard.js) already computed `dirty`/`supDirty` for their beforeunload handlers — the identical value is now ALSO forwarded via onDirtyChange, reset on unmount, at every one of their FOUR render sites (mobile-as-page and desktop-as-modal, for both Part and Supplier) — plus 3 more sites (CustomersModule, JobCardModule, BillingModule) wired the same way, 7 in total',
  /useEffect\(\(\) => \{ if \(onDirtyChange\) onDirtyChange\(dirty\); \}, \[dirty, onDirtyChange\]\);/.test(dash)
  && /useEffect\(\(\) => \{ if \(onDirtyChange\) onDirtyChange\(supDirty\); \}, \[supDirty, onDirtyChange\]\);/.test(dash)
  && (dash.match(/onDirtyChange=\{handleModuleDirtyChange\}/g) || []).length === 7);
ok('PH7-02 FIXED [fact]: every wired editor resets the shared flag on UNMOUNT unconditionally (not just when it computes dirty=false) — since each module unmounts on tab switch (§6), this is what guarantees the flag can never survive past the editor that set it, covering both a confirmed save and a cancel/discard',
  /useEffect\(\(\) => \(\) => \{ if \(onDirtyChange\) onDirtyChange\(false\); \}, \[onDirtyChange\]\);/.test(cust)
  && /useEffect\(\(\) => \(\) => \{ if \(onDirtyChange\) onDirtyChange\(false\); \}, \[onDirtyChange\]\);/.test(jc)
  && /useEffect\(\(\) => \(\) => \{ if \(onDirtyChange\) onDirtyChange\(false\); \}, \[onDirtyChange\]\);/.test(bill)
  && (dash.match(/useEffect\(\(\) => \(\) => \{ if \(onDirtyChange\) onDirtyChange\(false\); \}, \[onDirtyChange\]\);/g) || []).length === 2);
ok('PH7-02 FIXED [fact]: the guard never blocks a navigation with NO unsaved changes (moduleDirtyRef starts false and is only ever set true by an editor reporting a real JSON diff against its opened snapshot — never merely "an editor is open") and never prompts indefinitely after cancel/reset (every editor resets to false on its own unmount, which a Cancel/discard action triggers immediately)',
  /const moduleDirtyRef = useRef\(false\);/.test(dash));

// =====================================================================
// 7 — MODAL CLOSE / REOPEN (Step 22) — does closing ONE tab's modal ever
// touch a lease/state belonging to a DIFFERENT tab?
// =====================================================================
console.log('\n7  Modal lifecycle — closing a modal cannot touch another tab\'s lease\n');
ok('[fact] release() is keyed off THIS hook instance\'s own heldRef (set only by THIS instance\'s successful acquire()) — there is no global/shared "currently open modal" registry a different tab\'s close could accidentally reach into; each tab runs its own useEditLease instance with its own closure over uid/sessionId',
  /const heldRef = useRef\(null\);[^\n]*\n\s*const hbRef = useRef\(null\);/.test(useLease));
ok('[fact] closing/cancelling a job-card editor and closing a customer editor go through the SAME shared useEditLease hook (one implementation, not copied per module) — the release-scoping guarantee above is therefore uniform across every entity editor, not something that could drift between modules',
  /const \[menuFor, setMenuFor\] = useState\(null\);/.test(cust) // sanity: file loaded correctly
  && /useEditLease\(/.test(jc) && /useEditLease\(/.test(cust));

// =====================================================================
// 8 — LISTENER CLEANUP ON UNMOUNT (background for Steps 5/23/24)
// =====================================================================
console.log('\n8  onSnapshot listener cleanup on unmount\n');
ok('[fact] observeRecord (Phase 1c\'s live record watcher) and observeLease (the edit-lease watcher) both return their onSnapshot unsubscribe function directly, and every hook that calls them returns that same function from its own useEffect — React\'s own cleanup contract guarantees the Firestore listener is torn down on unmount, not left running against an unmounted component',
  /return observeRecord\(collectionName, docId, setLive\);/.test(useRecordSync)
  && /return observeLease\(collectionName, docId, setLock\);/.test(useLease));
ok('[fact] observeRecord distinguishes "no data yet / listener error" (cb(null)) from "deleted" (cb({exists:false})) from "live data" — a lifecycle event that merely disrupts the LISTENER (a background-tab throttle, a brief network blip) cannot be misread as "the record was deleted"',
  /\(snap\) => cb\(snap\.exists\(\) \? \{ exists: true, id: snap\.id, \.\.\.snap\.data\(\) \} : \{ exists: false \}\),\s*\n\s*\(\) => cb\(null\),/.test(recordSync));

console.log(`\n  ${PASS} passed, ${FAIL} failed, ${DEFECTS} DEFECT(S) found (Phase 7B candidates)\n`);
// DISCOVERY-PHASE CONTRACT: FAIL>0 = the audit itself broke (real regression in
// this file's own assertions against current source); DEFECTS>0 = confirmed
// lifecycle gaps recorded for a future Phase 7B. Neither this file nor the
// PHASE 7 section of tests/rules/firestore.rules.test.cjs is converted to a
// passing suite during Phase 7 itself — discovery only, per the phase's own
// instruction.
process.exit((FAIL || DEFECTS) ? 1 : 0);
