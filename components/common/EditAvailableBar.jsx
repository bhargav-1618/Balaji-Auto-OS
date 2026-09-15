// components/common/EditAvailableBar.jsx
//
// CONCURRENCY PHASE 1c — spec §12 / §20. Shown inside a record popup that a user
// is holding open VIEW-ONLY once the edit lease has been released. Non-blocking.
// The [Edit] button performs an authoritative lease acquisition (it is not enough
// to rely on the button merely being visible) — if another viewer wins the race,
// the caller keeps the popup view-only and tells the user.
import React from 'react';
import { Pencil } from 'lucide-react';

export default function EditAvailableBar({ onEdit, className = '' }) {
  return (
    <div
      role="status"
      className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2 text-xs ${className}`}
      style={{ background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.30)' }}
    >
      <span className="font-semibold text-emerald-300">✅ Editing available</span>
      <span className="text-emerald-200/80 flex-1">This record is now available to edit.</span>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold text-black bg-gradient-to-r from-[#34d399] to-[#059669]"
        >
          <Pencil size={12} /> Edit
        </button>
      )}
    </div>
  );
}
