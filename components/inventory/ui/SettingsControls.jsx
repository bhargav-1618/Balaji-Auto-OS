import React from 'react';
import { ImageOff, RefreshCw, Upload, Trash2 } from 'lucide-react';

// ---- Settings field primitives (HOISTED) --------------------------------
// These MUST live at module scope. When they were declared inside SettingsView,
// every keystroke re-created them, React treated each as a brand-new component
// type, and the input was unmounted + remounted — so the field lost focus after
// one character. At module scope their identity is stable and focus is retained.
export const SET_CARD_STYLE = { background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' };
export function SetSeg({ value, onChange, options }) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'rgba(var(--fg-rgb),0.04)' }}>
      {options.map((o) => (<button key={o.value} type="button" onClick={() => onChange(o.value)} className={`flex-1 px-3 py-1.5 rounded-lg text-sm font-semibold transition ${value === o.value ? 'bg-[#d4af37] text-black' : 'text-white/60 hover:text-white/90'}`}>{o.label}</button>))}
    </div>
  );
}
export function SetSel({ label, value, onChange, options }) {
  return (
    <div><label className="block text-[11px] uppercase tracking-wide text-white/45 mb-1.5">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white outline-none focus:border-[#d4af37]/60">{options.map((o) => <option key={o.value} value={o.value} style={{ background: 'var(--surface-2)' }}>{o.label}</option>)}</select>
    </div>
  );
}
export function SetTxt({ label, k, placeholder, optional, biz, bset, error, upper }) {
  return (
    <div><label className="block text-[11px] uppercase tracking-wide text-white/45 mb-1.5">{label}{optional && <span className="text-white/45 normal-case"> (optional)</span>}</label>
      <input
        value={biz[k] || ''}
        onChange={(e) => bset({ [k]: upper ? e.target.value.toUpperCase() : e.target.value })}
        placeholder={placeholder}
        className={`w-full px-3 py-2.5 rounded-xl text-sm bg-white/5 border text-white placeholder-white/25 outline-none transition ${error ? 'border-red-500/60 focus:border-red-500/80' : 'border-white/10 focus:border-[#d4af37]/60'}`}
      />
      {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}
export function SetCard({ title, desc, children }) {
  return (
    <div className="rounded-2xl p-5" style={SET_CARD_STYLE}>
      <h3 className="text-sm font-bold text-white/90 mb-1">{title}</h3>{desc && <p className="text-xs text-white/45 mb-4">{desc}</p>}
      {children}
    </div>
  );
}

// Business Logo — Branding card. Hoisted to module scope for the same reason
// Seg/Sel/Txt/Card are (see the comment above them): defining it inline inside
// SettingsView's render would give it a fresh component identity every render,
// remounting the preview <img>/file <input> on every keystroke elsewhere on the
// page. Upload/Replace/Remove are three states of ONE control, not three separate
// components, matching how the Part-photo uploader above reads as a single unit.
export function BrandingLogoField({ t, logoDataUrl, onUpload, onRemove }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wide text-white/45 mb-1.5">{t('settings.field.businessLogo', 'Business Logo')}</label>
      <p className="text-[11px] text-white/45 mb-3">{t('settings.logo.desc', 'Logo appears on printed invoices and other documents.')}</p>
      <div className="flex items-center gap-4 flex-wrap">
        {logoDataUrl ? (
          <div className="w-20 h-20 rounded-xl overflow-hidden flex-shrink-0 bg-white" style={{ border: '1px solid rgba(212,175,55,0.3)' }}>
            <img src={logoDataUrl} alt={t('settings.field.businessLogo', 'Business Logo')} className="w-full h-full object-contain" />
          </div>
        ) : (
          <div className="w-20 h-20 rounded-xl flex flex-col items-center justify-center gap-1 flex-shrink-0 bg-white/5 border border-dashed border-white/15 text-white/30">
            <ImageOff size={18} />
          </div>
        )}
        <div className="flex flex-col gap-2 min-w-0">
          {!logoDataUrl && <p className="text-xs text-white/45">{t('settings.logo.emptyState', 'No logo configured yet')}</p>}
          <div className="flex items-center gap-2 flex-wrap">
            <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer transition bg-white/5 border border-white/10 text-white/75 hover:bg-white/10">
              {logoDataUrl ? <RefreshCw size={13} /> : <Upload size={13} />}
              {logoDataUrl ? t('settings.logo.replaceButton', 'Replace Logo') : t('settings.logo.uploadButton', 'Upload Logo')}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onUpload} className="hidden" />
            </label>
            {logoDataUrl && (
              <button type="button" onClick={onRemove} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20">
                <Trash2 size={13} /> {t('settings.logo.removeButton', 'Remove Logo')}
              </button>
            )}
          </div>
          <p className="text-[10px] text-white/35">{t('settings.logo.formats', 'Supported formats: PNG, JPG, WEBP')}</p>
          <p className="text-[10px] text-white/35">{t('settings.logo.sizeGuidance', 'Max file size 5MB. Use a square or landscape logo for best results.')}</p>
        </div>
      </div>
    </div>
  );
}
