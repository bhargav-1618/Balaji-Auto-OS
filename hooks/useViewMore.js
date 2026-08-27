// hooks/useViewMore.js
// H-5E: extracted from components/InventoryDashboard.js — a reusable React
// concern (progressive "View More" pager, no artificial Top-N cap), zero
// business logic. Resets only when `resetKey` (the search/filter) changes —
// not when the list length changes — so paging position survives data
// re-renders.
import { useState, useEffect } from 'react';

export function useViewMore(list, step = 10, resetKey = '') {
  const [count, setCount] = useState(step);
  useEffect(() => { setCount(step); }, [resetKey, step]);
  return {
    visible: list.slice(0, count),
    hasMore: count < list.length,
    showMore: () => setCount((c) => c + step),
    shown: Math.min(count, list.length),
    total: list.length,
  };
}
