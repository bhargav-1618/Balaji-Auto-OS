// components/common/ConfirmDialog.jsx — global themed confirm dialog.
// Imperative API (like react-hot-toast) so any module can call confirmDialog(...)
// without threading a provider through props. Mount <ConfirmHost/> once.
import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

let _emit = null;

export function confirmDialog(opts = {}) {
  const options = typeof opts === 'string' ? { message: opts } : opts;
  if (!_emit) return Promise.resolve(window.confirm(options.message || 'Are you sure?'));
  return new Promise((resolve) => { _emit({ options, resolve }); });
}

export function ConfirmHost() {
  const [dialog, setDialog] = useState(null);
  const emit = useCallback((d) => setDialog(d), []);
  // Lock background scroll while a dialog is open. Without this the page behind the
  // modal scrolls under your finger on a phone, which on the shop floor means the
  // confirm button moves as you reach for it.
  useEffect(() => {
    if (!dialog) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [dialog]);

  useEffect(() => { _emit = emit; return () => { if (_emit === emit) _emit = null; }; }, [emit]);

  useEffect(() => {
    if (!dialog) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { dialog.resolve(false); setDialog(null); }
      else if (e.key === 'Enter') { dialog.resolve(true); setDialog(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]);

  if (!dialog) return null;
  const { title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false, icon } = dialog.options;
  const done = (v) => { dialog.resolve(v); setDialog(null); };
  const Icon = icon || (danger ? Trash2 : AlertTriangle);
  const accent = danger ? '#f87171' : '#d4af37';
  return (
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(3px)' }} onClick={() => done(false)}>
      <div className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl overflow-hidden anim-cd" style={{ background: 'var(--surface-1)', border: `1px solid ${accent}44` }} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
        <div className="p-5">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: `${accent}22` }}><Icon size={19} style={{ color: accent }} /></span>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-bold text-white">{title || (danger ? 'Delete this item?' : 'Are you sure?')}</h3>
              {message && <p className="text-sm text-white/55 mt-1 leading-relaxed">{message}</p>}
            </div>
            <button onClick={() => done(false)} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:bg-white/10 flex-shrink-0"><X size={15} /></button>
          </div>
        </div>
        <div className="flex gap-2 px-5 py-4" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.08)', background: 'var(--surface-2)', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {/* On a DESTRUCTIVE dialog the safe action takes focus. autoFocus used to sit
              unconditionally on the confirm button, so a user tapping Enter out of habit
              (having not read the message) would DELETE the invoice. Safe default wins. */}
          <button autoFocus={danger} onClick={() => done(false)} className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">{cancelText}</button>
          <button autoFocus={!danger} onClick={() => done(true)} className="flex-1 py-2.5 rounded-xl text-sm font-bold" style={{ background: danger ? 'linear-gradient(90deg,#f87171,#dc2626)' : 'linear-gradient(90deg,#d4af37,#aa801e)', color: danger ? '#fff' : '#000' }}>{confirmText}</button>
        </div>
      </div>
      <style>{`.anim-cd { animation: cdp .22s cubic-bezier(.2,.9,.3,1.1); } @keyframes cdp { 0% { transform: translateY(12px) scale(.97); opacity: 0; } 100% { transform: translateY(0) scale(1); opacity: 1; } } .reduce-motion .anim-cd { animation: none; }`}</style>
    </div>
  );
}
