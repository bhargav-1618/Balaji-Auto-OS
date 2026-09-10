import { useState, useEffect } from 'react';
import { Package } from 'lucide-react';
import { imageForPartName } from '../../../lib/partImages';

// ---------------------------------------------------------------------------
// Image thumbnail with hover preview (Base64)
// ---------------------------------------------------------------------------
// `demoMode` is passed in by the caller (was `useAuth().demoMode` when this lived
// inline in InventoryDashboard.js — Refactor Phase 11 made it an explicit prop so
// the thumbnail can be reused from the extracted OverviewView without pulling the
// auth context across the module boundary). demo => mandatory matched photo;
// production => optional.
export default function PartImageThumb({ src, alt, demoMode = false, onHover, onMove, onLeave }) {
  // Issue 1: if the image is missing OR fails to load (broken/invalid Base64),
  // fall back to the placeholder. Without this, a broken <img> collapses to a
  // thin sliver and only its gold border renders — the "thin yellow line".
  const [errored, setErrored] = useState(false);
  // Issue #5: when no external hover handler is supplied (e.g. the Overview /
  // Reorder / Low-stock widgets), the thumbnail manages its OWN enlarged preview
  // so hover works everywhere — not just the inventory table.
  const external = typeof onHover === 'function';
  const [preview, setPreview] = useState(null); // {x,y} for the self-contained preview
  useEffect(() => { setErrored(false); }, [src]); // reset when the row is reused

  // Image separation: in DEMO, every part gets a realistic catalog photo matched
  // by name (mandatory imagery). In PRODUCTION, images are optional — show the
  // real uploaded photo if present, otherwise a clean category icon (never a
  // forced/demo image). Hover preview is enabled only when an image exists.
  const realSrc = (!src || errored) ? null : src;
  const effectiveSrc = realSrc || (demoMode ? imageForPartName(alt || '') : null);
  const hasImage = !!effectiveSrc;

  if (!effectiveSrc) {
    return (
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: 'rgba(var(--fg-rgb),0.05)', border: '1px solid rgba(var(--fg-rgb),0.08)' }}
        title="No image"
      >
        <Package size={14} className="text-white/45" />
      </div>
    );
  }

  // Clamp the self-preview so it never overflows the viewport.
  const previewPos = preview ? (() => {
    const size = 200, pad = 16, off = 18;
    let left = preview.x + off, top = preview.y + off;
    if (typeof window !== 'undefined') {
      if (left + size + pad > window.innerWidth) left = preview.x - size - off;
      if (top + size + pad > window.innerHeight) top = window.innerHeight - size - pad;
      if (top < pad) top = pad;
      if (left < pad) left = pad;
    }
    return { left, top, size };
  })() : null;

  return (
    <>
      <img
        src={effectiveSrc}
        alt={alt}
        width={32}
        height={32}
        loading="lazy"
        decoding="async"
        onError={() => { if (src && !errored) setErrored(true); }}
        onMouseEnter={(e) => { if (external) onHover(effectiveSrc, e.clientX, e.clientY); else setPreview({ x: e.clientX, y: e.clientY }); }}
        onMouseMove={(e) => { if (external) { if (typeof onMove === 'function') onMove(e.clientX, e.clientY); } else setPreview({ x: e.clientX, y: e.clientY }); }}
        onMouseLeave={() => { if (external) { if (typeof onLeave === 'function') onLeave(); } else setPreview(null); }}
        className="rounded-full object-contain cursor-pointer transition-transform hover:scale-110 flex-shrink-0 block bg-white"
        style={{ width: 32, height: 32, minWidth: 32, border: '1.5px solid rgba(212,175,55,0.5)' }}
      />
      {previewPos && (
        <div className="pointer-events-none" style={{ position: 'fixed', left: previewPos.left, top: previewPos.top, zIndex: 200 }}>
          {/* contain, not cover — the source photos are pre-padded catalog shots, so
              the whole part must stay visible (never clipped) on a white card. */}
          <div className="rounded-xl shadow-2xl border-2 border-[#d4af37]/60 bg-white flex items-center justify-center" style={{ padding: 10 }}>
            <img
              src={effectiveSrc}
              alt={alt}
              style={{ maxWidth: previewPos.size, maxHeight: previewPos.size, width: 'auto', height: 'auto', display: 'block' }}
            />
          </div>
        </div>
      )}
    </>
  );
}
