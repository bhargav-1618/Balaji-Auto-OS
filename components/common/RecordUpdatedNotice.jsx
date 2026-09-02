// components/common/RecordUpdatedNotice.jsx
//
// CONCURRENCY PHASE 1c — the viewer-side banner. Shown in a record's detail / a
// read-only popup when another user has SAVED a change ('updated') or DELETED the
// record ('deleted') while it was open. Consistent wording and look across every
// module. No technical detail (no _rev, no session id, no Firestore) is shown.
import React from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';

export default function RecordUpdatedNotice({ status, onAcknowledge, className = '' }) {
  if (status !== 'updated' && status !== 'deleted') return null;

  const deleted = status === 'deleted';
  const tone = deleted
    ? { bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.32)', fg: '#fecaca', head: '#fca5a5' }
    : { bg: 'rgba(56,189,248,0.10)', border: 'rgba(56,189,248,0.32)', fg: '#bae6fd', head: '#7dd3fc' };
  const Icon = deleted ? Trash2 : RefreshCw;

  return (
    <div
      role="status"
      className={`flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-xs ${className}`}
      style={{ background: tone.bg, border: `1px solid ${tone.border}` }}
    >
      <Icon size={14} className="mt-0.5 flex-shrink-0" style={{ color: tone.head }} />
      <div className="leading-relaxed" style={{ color: tone.fg }}>
        <span className="font-semibold" style={{ color: tone.head }}>
          {deleted ? 'Record deleted' : 'Record updated'}
        </span>
        {deleted
          ? ' — Another user deleted this record.'
          : ' — This record was updated by another user.'}
        {onAcknowledge && (
          <button
            type="button"
            onClick={onAcknowledge}
            className="ml-2 inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-semibold transition"
            style={{ background: 'rgba(var(--fg-rgb),0.10)', color: tone.head, border: `1px solid ${tone.border}` }}
          >
            {deleted ? 'Dismiss' : 'View Updated Record'}
          </button>
        )}
      </div>
    </div>
  );
}
