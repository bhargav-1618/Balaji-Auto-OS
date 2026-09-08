import React, { useState, useEffect } from 'react';
import { ChevronUp } from 'lucide-react';
import { appScrollY, appScrollTo, onAppScroll } from '../../../lib/appScroll';

// clears the mobile bottom-nav, never overlaps modals (z below them).
export default function ScrollToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    // rAF-throttle: coalesce a burst of scroll events into one read per frame, and only
    // call setState when the boolean crosses the 400px threshold — not on every event.
    let ticking = false;
    let shown = false;
    const evaluate = () => {
      ticking = false;
      const next = appScrollY() > 400;
      if (next !== shown) { shown = next; setShow(next); }
    };
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(evaluate); } };
    const off = onAppScroll(onScroll);
    evaluate();
    return off;
  }, []);
  return (
    <button
      onClick={() => appScrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Back to top"
      className={`fixed z-[80] bottom-24 md:bottom-6 right-4 md:right-6 w-11 h-11 rounded-full flex items-center justify-center shadow-xl transition-all duration-300 ${show ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-3 pointer-events-none'}`}
      style={{ background: 'linear-gradient(135deg,#d4af37,#aa801e)', color: '#1a1a1a' }}
    >
      <ChevronUp size={20} />
    </button>
  );
}
