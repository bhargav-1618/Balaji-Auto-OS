// components/common/RecordConflictBanner.jsx
//
// CONCURRENCY PHASE 1c — the editor-side banner. Shown INSIDE an open editor when
// the record changed underneath it ('updated') or was deleted ('deleted') by
// another user / an admin / a background workflow. The user's in-progress form is
// never touched — this only tells them and offers a next step.
import React from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';

export default function RecordConflictBanner({ status, onReview, onClose, className = '' }) {
  if (status !== 'updated' && status !== 'deleted') return null;

  const deleted = status === 'deleted';
  const tone = deleted
    ? { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.35)', fg: '#fecaca', head: '#fca5a5' }
    : { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)', fg: '#fde68a', head: '#fbbf24' };
  const Icon = deleted ? Trash2 : AlertTriangle;

  return (
    <div
      role={deleted ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-xs ${className}`}
      style={{ background: tone.bg, border: `1px solid ${tone.border}` }}
    >
      <Icon size={14} className="mt-0.5 flex-shrink-0" style={{ color: tone.head }} />
      <div className="leading-relaxed" style={{ color: tone.fg }}>
        <span className="font-semibold" style={{ color: tone.head }}>
          {deleted ? 'Record deleted' : 'Updated elsewhere'}
        </span>
        {deleted
          ? ' — Another user deleted this record. Your changes were not saved.'
          : ' — Another user changed this record while you were working. Your changes here are safe.'}
        <span className="mt-1.5 flex gap-2">
          {!deleted && onReview && (
            <button
              type="button"
              onClick={onReview}
              className="inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-semibold transition"
              style={{ background: 'rgba(var(--fg-rgb),0.10)', color: tone.head, border: `1px solid ${tone.border}` }}
            >
              Review Latest
            </button>
          )}
          {deleted && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-semibold transition"
              style={{ background: 'rgba(var(--fg-rgb),0.10)', color: tone.head, border: `1px solid ${tone.border}` }}
            >
              Close
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
