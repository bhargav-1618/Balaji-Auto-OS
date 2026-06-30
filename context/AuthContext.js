// context/AuthContext.js
import { createContext, useContext, useEffect, useState } from 'react';
import { auth, db, doc, onSnapshot, onAuthStateChanged } from '../lib/firebase';

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

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [dbAdmins, setDbAdmins] = useState([]); // admin emails from Firestore
  const [staffPerms, setStaffPerms] = useState({}); // { email: {costPrices,deletes,exports} }
  const [role, setRole] = useState(null); // 'admin' | 'staff' | 'guest'
  const [perms, setPerms] = useState({ costPrices: false, deletes: false, exports: false });
  const [loading, setLoading] = useState(true);
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
  useEffect(() => {
    if (demoMode) return;
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
  }, [demoMode]);

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
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser || null);
      setLoading(false);
    });
    return unsubscribe;
  }, [demoMode, demoAdmin]);

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

  const exitDemo = () => { try { sessionStorage.removeItem('maruti_demo'); sessionStorage.removeItem('maruti_demo_admin'); sessionStorage.removeItem('maruti_demo_inv'); sessionStorage.removeItem('maruti_demo_sup'); } catch {}; if (typeof window !== 'undefined') window.location.href = demoAdmin ? '/' : '/login'; };

  return (
    <AuthContext.Provider value={{ user, role, perms, loading, dbAdmins, staffPerms, bootstrapAdmins: BOOTSTRAP_ADMINS, demoMode, demoAdmin, exitDemo }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
