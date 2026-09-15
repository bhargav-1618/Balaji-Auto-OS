// hooks/useImageHoverPreview.js
// Refactor Phase 14 — extracted verbatim from components/InventoryDashboard.js. A
// reusable UI-only concern: a single root-level image hover preview tracked by mouse
// coordinates, with the mouse-move updates throttled to one state change per frame
// (otherwise a large base64 preview re-renders the whole table on every pixel). Zero
// business logic, no Firestore, no navigation. The caller renders the floating
// preview from `hoveredImage` and wires the three handlers into its thumbnails.
import { useState, useRef, useCallback } from 'react';

export function useImageHoverPreview() {
  // Fix 5: single root-level hover preview, tracked by mouse coordinates
  const [hoveredImage, setHoveredImage] = useState({ src: null, x: 0, y: 0 });
  // Perf hardening: throttle mouse-move updates to one state change per frame
  // (otherwise a large base64 preview re-renders the whole table on every pixel).
  const hoverRafRef = useRef(0);
  const hoverCoordsRef = useRef({ x: 0, y: 0 });
  const handleImageHover = useCallback((src, x, y) => { if (src) setHoveredImage({ src, x, y }); }, []);
  const handleImageMove = useCallback((x, y) => {
    hoverCoordsRef.current = { x, y };
    if (hoverRafRef.current) return;
    hoverRafRef.current = requestAnimationFrame(() => {
      hoverRafRef.current = 0;
      const c = hoverCoordsRef.current;
      setHoveredImage((h) => (h.src ? { ...h, x: c.x, y: c.y } : h));
    });
  }, []);
  const handleImageLeave = useCallback(() => {
    if (hoverRafRef.current) {
      cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = 0;
    }
    setHoveredImage({ src: null, x: 0, y: 0 });
  }, []);
  return { hoveredImage, handleImageHover, handleImageMove, handleImageLeave };
}
