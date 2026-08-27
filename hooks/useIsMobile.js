// hooks/useIsMobile.js
// H-5E: extracted from components/InventoryDashboard.js — a reusable React
// concern (viewport-size detection via matchMedia), zero business logic.
// SSR-safe: starts false, resolves on mount, updates on resize.
import { useState, useEffect } from 'react';

export function useIsMobile(breakpoint = 768) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const apply = () => setMobile(mq.matches);
    apply();
    mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply);
    return () => { mq.removeEventListener ? mq.removeEventListener('change', apply) : mq.removeListener(apply); };
  }, [breakpoint]);
  return mobile;
}
