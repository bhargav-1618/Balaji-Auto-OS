// components/common/ConflictReviewDialog.jsx
//
// CONCURRENCY PHASE 1c — spec §5 / §6. The reconciliation surface shown when an
// editor clicks "Review Latest": what changed on the server since they opened the
// record, so they consciously decide. Nothing is ever auto-merged and the guarded
// `_rev` transaction is never bypassed.
//
// Two modes:
//   mode="rebase"  — the editor's form is record-shaped, so a field-level rebase is
//                    safe: latest server record + the user's changes on fields the
//                    other user did NOT touch. Fields BOTH sides changed are shown
//                    and the user must pick each one. (Customers.)
//       [Keep my changes]  → onKeepMine(mergedRecord)
//       [Use the latest version] → onUseLatest(latest)
//   mode="review"  — the editor transforms field shapes (line items, vehicle trees),
//                    so an automatic field merge is not safe. Show exactly what the
//                    other user changed; the user chooses.
//       [Load the latest version] → onUseLatest(latest)  (my edits discarded — explicit)
//       [Keep editing mine]       → onClose()            (save will be re-checked)
//
// Arrays / objects are shown as ONE changed unit — there is no element-level merge.
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowRight, GitMerge } from 'lucide-react';
import { rebaseRecord, fieldsEqual } from '../../lib/recordSync';

function summarise(v) {
  if (v === undefined || v === null || v === '') return '—';
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  if (typeof v === 'object') return 'changed';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const s = String(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

export default function ConflictReviewDialog({
  title = 'Review the latest version',
  mode = 'rebase',
  fields = [],
  opened,
  local,
  latest,
  onKeepMine,
  onUseLatest,
  onClose,
}) {
  const keys = useMemo(() => fields.map((f) => f.key), [fields]);
  const rebase = mode === 'rebase';

  const { conflicts } = useMemo(
    () => (rebase ? rebaseRecord(opened, local, latest, { keys }) : { conflicts: [] }),
    [rebase, opened, local, latest, keys],
  );

  // Every field that moved since the editor opened.
  const rows = useMemo(() => fields
    .map((f) => {
      const mineChanged = rebase && !fieldsEqual(local ? local[f.key] : undefined, opened ? opened[f.key] : undefined);
      const theirsChanged = !fieldsEqual(latest ? latest[f.key] : undefined, opened ? opened[f.key] : undefined);
      return {
        ...f,
        mineChanged,
        theirsChanged,
        conflict: mineChanged && theirsChanged,
        opened: opened ? opened[f.key] : undefined,
        mine: local ? local[f.key] : undefined,
        theirs: latest ? latest[f.key] : undefined,
      };
    })
    .filter((r) => r.mineChanged || r.theirsChanged), [fields, local, latest, opened, rebase]);

  const [picks, setPicks] = useState({});
  const allConflictsPicked = conflicts.every((c) => picks[c.key] === 'mine' || picks[c.key] === 'theirs');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const keepMine = () => {
    const { merged } = rebaseRecord(opened, local, latest, { keys });
    conflicts.forEach((c) => { merged[c.key] = picks[c.key] === 'mine' ? c.mine : c.theirs; });
    onKeepMine?.(merged);
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full sm:max-w-2xl h-[100dvh] sm:h-auto max-h-[100dvh] sm:max-h-[calc(100dvh-2rem)] flex flex-col rounded-t-2xl sm:rounded-2xl overflow-hidden"
        style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
          <h3 className="text-base font-bold text-white flex items-center gap-2"><GitMerge size={16} className="text-[#d4af37]" /> {title}</h3>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/60 transition"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto overscroll-contain flex-1 min-h-0 p-5 space-y-3">
          <p className="text-xs text-white/60 leading-relaxed">
            Another user saved changes to this record while you were editing. Below is what
            changed. Your own unsaved edits are safe — nothing is saved until you choose.
          </p>

          {rows.length === 0 && (
            <p className="text-xs text-white/45">No field-level differences to show.</p>
          )}

          {rows.map((r) => (
            <div
              key={r.key}
              className="rounded-xl p-3"
              style={{
                background: r.conflict ? 'rgba(245,158,11,0.08)' : 'rgba(var(--fg-rgb),0.03)',
                border: `1px solid ${r.conflict ? 'rgba(245,158,11,0.30)' : 'rgba(var(--fg-rgb),0.08)'}`,
              }}
            >
              <p className="text-[11px] font-semibold text-white/80 mb-2 flex items-center gap-2">
                {r.label}
                {r.conflict && <span className="text-[10px] font-bold uppercase tracking-wide text-amber-300">Conflict — pick one</span>}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                <button
                  type="button"
                  disabled={!r.conflict}
                  onClick={() => r.conflict && setPicks((p) => ({ ...p, [r.key]: 'theirs' }))}
                  className="text-left rounded-lg px-2.5 py-2 transition disabled:cursor-default"
                  style={{
                    background: picks[r.key] === 'theirs' ? 'rgba(56,189,248,0.16)' : 'rgba(var(--fg-rgb),0.04)',
                    border: `1px solid ${picks[r.key] === 'theirs' ? 'rgba(56,189,248,0.5)' : 'rgba(var(--fg-rgb),0.10)'}`,
                  }}
                >
                  <span className="block text-white/45 mb-0.5">{rebase ? 'Latest (another user)' : 'Was'}</span>
                  <span className="block font-semibold text-white/85">{(r.format || summarise)(rebase ? r.theirs : r.opened)}</span>
                </button>
                <button
                  type="button"
                  disabled={!r.conflict}
                  onClick={() => r.conflict && setPicks((p) => ({ ...p, [r.key]: 'mine' }))}
                  className="text-left rounded-lg px-2.5 py-2 transition disabled:cursor-default disabled:opacity-60"
                  style={{
                    background: picks[r.key] === 'mine' ? 'rgba(212,175,55,0.16)' : 'rgba(var(--fg-rgb),0.04)',
                    border: `1px solid ${picks[r.key] === 'mine' ? 'rgba(212,175,55,0.5)' : 'rgba(var(--fg-rgb),0.10)'}`,
                  }}
                >
                  <span className="block text-white/45 mb-0.5">{rebase ? 'My unsaved change' : 'Now (another user)'}</span>
                  <span className="block font-semibold text-white/85">{(r.format || summarise)(rebase ? r.mine : r.theirs)}</span>
                </button>
              </div>
              {rebase && !r.conflict && r.theirsChanged && (
                <p className="text-[10px] text-white/40 mt-1.5">Only the other user changed this — the latest value is kept.</p>
              )}
              {rebase && !r.conflict && r.mineChanged && !r.theirsChanged && (
                <p className="text-[10px] text-white/40 mt-1.5">Only you changed this — your value is kept.</p>
              )}
            </div>
          ))}

          {!rebase && (
            <p className="text-[11px] text-white/45 leading-relaxed">
              This editor has structured fields that can’t be merged automatically. Load the
              latest version and re-apply your edits, or keep editing — your save will be
              checked against the latest version again.
            </p>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-white/10 px-5 py-3 flex flex-col sm:flex-row gap-2" style={{ background: 'var(--surface-1)', paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          {rebase ? (
            <>
              <button
                type="button"
                onClick={keepMine}
                disabled={!allConflictsPicked}
                className="flex-1 h-10 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <GitMerge size={14} /> Keep my changes
              </button>
              <button
                type="button"
                onClick={() => onUseLatest?.({ ...(latest || {}) })}
                className="flex-1 h-10 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 flex items-center justify-center gap-1.5"
              >
                <ArrowRight size={14} /> Use the latest version
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onUseLatest?.({ ...(latest || {}) })}
              className="flex-1 h-10 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center justify-center gap-1.5"
            >
              <ArrowRight size={14} /> Load the latest version
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-xl text-xs font-semibold bg-transparent border border-white/10 text-white/60 hover:bg-white/5"
          >
            {rebase ? 'Cancel' : 'Keep editing mine'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
