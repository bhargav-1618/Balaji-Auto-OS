import React from 'react';
import { ChevronLeft } from 'lucide-react';

// Full-screen mobile page shell: a viewport-capped flex column — non-shrinking back
// header, then children in ONE scroll region below. Shared by every long inventory
// form so phones get consistent, reliable scrolling. (See PH27-01 below for why this
// can't lean on document scroll the way it originally did.)
export default function MobileFormPage({ title, onClose, children }) {
  // PH27-01 — this used to be `min-h-screen flex flex-col` with {children} in normal
  // document flow, on the assumption (see the old comments at every asPage call site)
  // that "the BODY scrolls natively". It does NOT: the app shell pins
  // `html, body { position: fixed; overflow: hidden; height: 100dvh }` (styles/globals.css)
  // so the document itself can never be scrolled by touch or wheel — and this page
  // renders BEFORE <main id="app-scroll">, so there is no shell scroll container either.
  // Any form taller than the viewport (short phones, on-screen keyboard open, long
  // validation text, draft/offline banners) had its lower fields — including required
  // ones — clipped below the fold with no way to reach them. Fix mirrors the
  // Customers/Vehicles/Billing full-screen editors: cap to the dynamic viewport and
  // give the content ONE real scroll region.
  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden" style={{ background: 'var(--surface-0)' }}>
      <div
        className="flex-shrink-0 flex items-center gap-2 px-3 py-3"
        style={{ background: 'var(--surface-1)', borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}
      >
        <button type="button" onClick={onClose} aria-label="Back" className="w-10 h-10 -ml-1 rounded-full flex items-center justify-center text-white/75 active:bg-white/10 transition">
          <ChevronLeft size={24} />
        </button>
        <div className="text-base font-bold bg-gradient-to-r from-[#d4af37] to-[#aa801e] bg-clip-text text-transparent">{title}</div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto dark-scroll">
        {children}
      </div>
    </div>
  );
}
