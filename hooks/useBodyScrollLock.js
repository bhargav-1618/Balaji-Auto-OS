// hooks/useBodyScrollLock.js
// H-5E: extracted from components/InventoryDashboard.js — a reusable React
// concern (a reference-counted body-scroll lock for the lifetime of a mounted
// modal/page), zero business logic. Sharing one counted lock instead of each
// modal setting/clearing overflow directly is what prevents the page ending up
// either stuck locked (nothing open) or unlocked behind an open modal.
import { useEffect } from 'react';
import { lockBody, unlockBody } from '../components/Modal';

export function useBodyScrollLock(enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    const t = lockBody();
    return () => unlockBody(t);
  }, [enabled]);
}
