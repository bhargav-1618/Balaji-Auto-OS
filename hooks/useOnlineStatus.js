// hooks/useOnlineStatus.js
// Refactor Phase 14 — extracted verbatim from components/InventoryDashboard.js.
// Isolated browser-event handling: tracks navigator.onLine via the window
// online/offline events into a React flag. `navigator.onLine` is only a
// connectivity HINT (a captive portal can report "online" while nothing real is
// reachable), so callers use this as a UX signal, never as a hard gate. Zero
// business logic.
import { useState, useEffect } from 'react';

export function useOnlineStatus() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    if (typeof navigator !== 'undefined') setOnline(navigator.onLine);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return online;
}
