// components/common/BarcodeScanButton.jsx
// Issue 7.1 (Stock Operations review) — the ONE "scan a barcode to identify a
// part" entry point, built on the shared useBarcodeScanner hook so any other
// workflow that later needs the same identification step (Adjust Stock,
// Purchase Order receiving, ...) reuses this instead of a second camera UI.
// Renders nothing when the device/browser doesn't support it (feature-detected,
// not a broken button) — matches the brief's "where the device/browser
// supports it" framing.
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { ScanLine, X } from 'lucide-react';
import { useBarcodeScanner, isBarcodeScanSupported } from '../../hooks/useBarcodeScanner';

export default function BarcodeScanButton({ onDetect, className, label = 'Scan Barcode' }) {
  const [open, setOpen] = useState(false);
  const { videoRef, scanning, error, start, stop } = useBarcodeScanner((code) => { onDetect(code); setOpen(false); });

  if (!isBarcodeScanSupported()) return null;

  const handleOpen = () => { setOpen(true); start(); };
  const handleClose = () => { stop(); setOpen(false); };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={className || 'flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:border-[#d4af37]/40 transition flex-shrink-0'}
      >
        <ScanLine size={14} /> {label}
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.9)' }} onClick={handleClose}>
          <div className="w-full max-w-sm rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
              <h3 className="text-sm font-bold text-white flex items-center gap-2"><ScanLine size={15} className="text-[#d4af37]" /> Scan Barcode</h3>
              <button onClick={handleClose} className="text-white/45 hover:text-white"><X size={16} /></button>
            </div>
            <div className="relative aspect-square bg-black">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
              <div className="absolute inset-8 border-2 border-[#d4af37]/70 rounded-xl pointer-events-none" />
            </div>
            <div className="p-3 text-center">
              {error ? (
                <p className="text-xs text-red-400">{error}</p>
              ) : (
                <p className="text-xs text-white/45">{scanning ? 'Point the camera at a barcode…' : 'Starting camera…'}</p>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
