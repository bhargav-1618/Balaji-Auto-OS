// hooks/useBootSplash.js
// Refactor Phase 14 — extracted verbatim from components/InventoryDashboard.js.
// Presentation-only lifecycle coordination for the login -> app transition:
//   - `arriving`  : the one-time light-bloom settle after login sets `maruti_arrival`
//   - `bootFading`/`bootHidden` : the branded splash held on top until the first data
//     load resolves, then faded out and unmounted (removes the blank content frame)
// Timers only, one harmless sessionStorage read of the login handoff flag, and a
// prefers-reduced-motion gate. No business logic, no Firestore, no navigation.
import { useState, useEffect } from 'react';

export function useBootSplash(loading) {
  // Continuous login->app transition: login sets maruti_arrival before departing;
  // we settle in from the light bloom, then clear the flag.
  const [arriving, setArriving] = useState(false);
  // Keep a branded splash on top until the first data load resolves, then fade it
  // out — this removes the blank/white content frame right after login.
  const [bootFading, setBootFading] = useState(false);
  const [bootHidden, setBootHidden] = useState(false);
  useEffect(() => {
    if (loading || bootHidden) return undefined;
    // data has arrived — fade the splash, then unmount it
    const t1 = setTimeout(() => setBootFading(true), 60);
    const t2 = setTimeout(() => setBootHidden(true), 460);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [loading, bootHidden]);
  useEffect(() => {
    let t;
    try {
      if (sessionStorage.getItem('maruti_arrival') === '1') {
        sessionStorage.removeItem('maruti_arrival');
        if (!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
          setArriving(true);
          t = setTimeout(() => setArriving(false), 950);
        }
      }
    } catch {}
    return () => clearTimeout(t);
  }, []);
  return { arriving, bootFading, bootHidden };
}
