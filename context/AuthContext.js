// context/AuthContext.js
import { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { auth, db, doc, onSnapshot, onAuthStateChanged } from '../lib/firebase';
import { clearBusinessCaches } from '../lib/session';

const AuthContext = createContext(null);

// ---------------------------------------------------------------------------
// ROLE MODEL (read this before changing anything)
//
// Roles are now managed from the in-app Settings page, stored in Firestore at
// appSettings/roles  ->  { admins: ["email@x.com", ...] }.
//
// BOOTSTRAP_ADMINS below is a permanent, code-level safety net: these emails are
// ALWAYS admin, even if the database list is empty, fails to load, or someone
// removes them by mistake. This guarantees the owner can never be locked out of
// their own shop. Manage everyone else from Settings → Staff & Access.
//
// Security note: Firestore rules use `request.auth != null` (single-trusted-shop
// model), so this role controls what the UI exposes (cost prices, deletes,
// exports, Settings powers) — it is access control at the app level, not a
// cryptographic guarantee. Appropriate for a small trusted team.
// ---------------------------------------------------------------------------
const BOOTSTRAP_ADMINS = [
  'konabhargav2003@gmail.com', // owner — permanent admin, never removable from UI
];
const norm = (e) => (e || '').trim().toLowerCase();

// H-3: if onAuthStateChanged hasn't resolved (success OR failure) by this long, the app
// used to sit on the Boot Splash forever with no way out but killing the tab. This is
// purely a UI-recovery timer — it never fabricates a signed-out/signed-in state; it just
// offers a retry once it's clear something is stuck.
const AUTH_INIT_TIMEOUT_MS = 12000;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [dbAdmins, setDbAdmins] = useState([]); // admin emails from Firestore
  const [staffPerms, setStaffPerms] = useState({}); // { email: {costPrices,deletes,exports} }
  const [role, setRole] = useState(null); // 'admin' | 'staff' | 'guest'
  const [perms, setPerms] = useState({ costPrices: false, deletes: false, exports: false });
  const [loading, setLoading] = useState(true);
  // H-3: surfaces a retry affordance if auth init stalls; bumping authRetryNonce cleanly
  // tears down and re-subscribes onAuthStateChanged (no duplicate listeners — the effect's
  // own cleanup unsubscribes the stalled one first).
  const [authTimedOut, setAuthTimedOut] = useState(false);
  const [authRetryNonce, setAuthRetryNonce] = useState(0);
  const [demoMode, setDemoMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return sessionStorage.getItem('maruti_demo') === '1' ||
        new URLSearchParams(window.location.search).get('demo') === '1' ||
        new URLSearchParams(window.location.search).get('demo') === 'admin';
    } catch { return false; }
  });
  const [demoAdmin, setDemoAdmin] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return sessionStorage.getItem('maruti_demo_admin') === '1' ||
        new URLSearchParams(window.location.search).get('demo') === 'admin';
    } catch { return false; }
  });

  // Persist the demo flag if it arrived via URL (so it survives in-app navigation).
  useEffect(() => {
    try {
      const param = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('demo') : null;
      if (param === '1' || param === 'admin') { sessionStorage.setItem('maruti_demo', '1'); setDemoMode(true); }
      if (param === 'admin') { sessionStorage.setItem('maruti_demo_admin', '1'); setDemoAdmin(true); }
    } catch {}
  }, []);

  // Subscribe to the role list in Firestore. Skipped entirely in demo mode.
  // H-4 fix: this used to depend only on [demoMode], so it subscribed on AuthProvider's
  // very first render — potentially before onAuthStateChanged had delivered a user.
  // Firestore rules require request.auth != null, so a subscribe that races auth could
  // get permission-denied, fall back to BOOTSTRAP_ADMINS, and (since `user` wasn't a
  // dependency) never retry for the rest of the session. Now it waits for auth to finish
  // resolving (`loading === false`) AND a real user to exist before subscribing at all —
  // the race is removed at the source instead of retried after the fact. If `user` later
  // changes (sign-out/sign-in), the effect re-runs: cleanup unsubscribes the old listener
  // first, so there is never more than one active subscription.
  useEffect(() => {
    if (demoMode || loading || !user) return;
    let unsub = () => {};
    try {
      unsub = onSnapshot(
        doc(db, 'appSettings', 'roles'),
        (snap) => {
          const data = snap.exists() ? snap.data() : null;
          const admins = Array.isArray(data?.admins) ? data.admins.map(norm) : [];
          setDbAdmins(admins);
          const sp = {};
          if (data && data.staff && typeof data.staff === 'object') {
            Object.entries(data.staff).forEach(([email, p]) => { sp[norm(email)] = p || {}; });
          }
          setStaffPerms(sp);
        },
        (err) => { console.error('Roles sync (using bootstrap admins):', err); setDbAdmins([]); setStaffPerms({}); }
      );
    } catch (e) {
      console.error('Roles subscription failed (using bootstrap admins):', e);
    }
    return () => { try { unsub(); } catch {} };
  }, [demoMode, loading, user]);

  useEffect(() => {
    if (demoMode) {
      // Synthetic read-only guest — no Firebase auth involved.
      setUser({ email: demoAdmin ? 'demo-admin@balajiautoos.com' : 'demo@balajiautoos.com', isDemo: true, isDemoAdmin: demoAdmin, displayName: demoAdmin ? 'Demo Admin' : 'Demo User' });
      setRole('guest');
      // Demo User: add/edit only. Demo Admin: may also delete/archive/reset (demo only).
      setPerms({ costPrices: true, deletes: !!demoAdmin, exports: true });
      setLoading(false);
      return;
    }
    // H-3: start a recovery timer alongside the real listener. If onAuthStateChanged
    // hasn't called back (success OR failure — Firebase always calls back eventually in
    // normal operation, but a blocked network request, ad-blocker, or an uncaught error
    // inside the SDK's init path could mean it never does) within AUTH_INIT_TIMEOUT_MS,
    // surface a retry affordance instead of leaving the Boot Splash spinning forever.
    // The timer never touches `user`/`loading` itself — it only flips a separate flag the
    // UI can act on, so it can't fabricate a false auth result.
    setAuthTimedOut(false);
    const timer = setTimeout(() => setAuthTimedOut(true), AUTH_INIT_TIMEOUT_MS);
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      clearTimeout(timer);
      setAuthTimedOut(false);
      setUser(firebaseUser || null);
      setLoading(false);
    });
    return () => { clearTimeout(timer); unsubscribe(); };
  }, [demoMode, demoAdmin, authRetryNonce]);

  // H-3: lets the UI retry auth init without a full page reload. Bumping the nonce
  // re-runs the effect above; its cleanup unsubscribes/clears the stalled listener and
  // timer FIRST, so this can never leave two onAuthStateChanged listeners active at once.
  const retryAuthInit = useCallback(() => {
    setAuthTimedOut(false);
    setAuthRetryNonce((n) => n + 1);
  }, []);

  // Recompute role + permissions whenever the user OR the role data changes.
  useEffect(() => {
    if (demoMode) return; // guest perms fixed above
    if (!user) { setRole(null); setPerms({ costPrices: false, deletes: false, exports: false }); return; }
    const email = norm(user.email);
    const isAdmin = BOOTSTRAP_ADMINS.map(norm).includes(email) || dbAdmins.includes(email);
    if (isAdmin) {
      setRole('admin');
      setPerms({ costPrices: true, deletes: true, exports: true });
    } else {
      setRole('staff');
      const p = staffPerms[email] || {};
      setPerms({ costPrices: !!p.costPrices, deletes: !!p.deletes, exports: !!p.exports });
    }
  }, [user, dbAdmins, staffPerms, demoMode]);

  // useCallback, not a bare arrow: an unstable identity here would defeat the useMemo on
  // the context value below (a new exitDemo every render = a new context value every
  // render = every useAuth() consumer re-renders anyway).
  const exitDemo = useCallback(() => {
    try {
      sessionStorage.removeItem('maruti_demo');
      sessionStorage.removeItem('maruti_demo_admin');
    } catch (e) { console.error('[auth] could not clear demo flags', e); }
    // Clear the demo dataset too — otherwise a real user logging in afterwards can be
    // shown demo customers/invoices from cache before their own data loads.
    clearBusinessCaches();
    if (typeof window !== 'undefined') window.location.href = demoAdmin ? '/' : '/login';
  }, [demoAdmin]);

  // MEMOISED. This was an inline object literal, so a NEW context value was created on
  // every render of AuthProvider — which forces every single useAuth() consumer to
  // re-render even when nothing about the user actually changed. In a 16-module ERP
  // shell that is a lot of wasted work on every keystroke that touches auth state.
  const value = useMemo(() => ({
    user, role, perms, loading, dbAdmins, staffPerms,
    bootstrapAdmins: BOOTSTRAP_ADMINS, demoMode, demoAdmin, exitDemo,
    authTimedOut, retryAuthInit,
  }), [user, role, perms, loading, dbAdmins, staffPerms, demoMode, demoAdmin, exitDemo, authTimedOut, retryAuthInit]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
