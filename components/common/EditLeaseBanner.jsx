// components/common/EditLeaseBanner.jsx
//
// CONCURRENCY PHASE 1b — STATE C. Shown in a record's detail view when another
// user holds the edit lease. Consistent wording and look across every module.
// No technical detail (no sessionId, no revision, no doc id) is shown.
import React from 'react';
import { Lock } from 'lucide-react';

export default function EditLeaseBanner({ status, heldByEmail, className = '' }) {
  if (status !== 'held') return null;
  const who = heldByEmail && heldByEmail !== 'another user' ? heldByEmail : 'another user';
  return (
    <div
      role="status"
      className={`flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-xs ${className}`}
      style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.30)' }}
    >
      <Lock size={14} className="mt-0.5 flex-shrink-0 text-amber-400" />
      <div className="text-amber-200/90 leading-relaxed">
        <span className="font-semibold text-amber-300">Currently being edited</span>
        {' — '}this record is open for editing by {who}. You can view the latest
        information, but editing is temporarily unavailable.
      </div>
    </div>
  );
}
