// components/common/CapacityBanner.jsx
//
// Drop-in capacity warning/blocked banner for one module. Owns its own "manage records"
// modal, so wiring a new module in is just:
//
//     <CapacityBanner moduleKey="jobCards" demoMode={demoMode} actorEmail={user?.email}
//                      refreshKey={jobCards.length} onCleanupComplete={() => refetch()} />
//
// Shows NOTHING below the warning threshold — this is intentionally invisible for the
// overwhelming majority of a workshop's life. At/above the warning threshold it shows a
// non-blocking amber notice; at the hard limit it shows a blocking red one with the
// cleanup entry point. Never both at once, never on every page load once dismissed for
// the current count band (see DISMISS_BUCKET below) — the brief is explicit that this
// must not spam an identical warning repeatedly.
import React, { useMemo, useState, useCallback } from 'react';
import { TriangleAlert, X, Settings2 } from 'lucide-react';
import { useCapacityStatus } from '../../lib/useCapacity';
import CapacityCleanupModal from './CapacityCleanupModal';
import { CAPACITY_MODULES } from '../../constants/capacity';
import { pluralize } from '../../lib/format';

// A dismissal is remembered per 100-record band. Once the count crosses into the next
// band the warning reappears — the user genuinely has 100 more records' worth of new
// information, not a repeat of what they already dismissed.
const bandOf = (count) => Math.floor(count / 100) * 100;
const dismissKey = (moduleKey, band) => `capacity_dismiss_${moduleKey}_${band}`;

export default function CapacityBanner({
  moduleKey, demoMode, actorEmail, ctx, refreshKey = 0, onCleanupComplete, className = '',
}) {
  const cfg = CAPACITY_MODULES[moduleKey];
  const [cleanupTick, setCleanupTick] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [, forceUpdate] = useState(0); // re-render after a dismiss write to sessionStorage

  const { status, loading } = useCapacityStatus(moduleKey, {
    demoMode, refreshKey: `${refreshKey}-${cleanupTick}`,
  });

  const band = status ? bandOf(status.count) : 0;
  const dismissed = useMemo(() => {
    if (typeof window === 'undefined' || !status) return false;
    try { return sessionStorage.getItem(dismissKey(moduleKey, band)) === '1'; } catch { return false; }
  }, [moduleKey, band, status]);

  const dismiss = useCallback(() => {
    try { sessionStorage.setItem(dismissKey(moduleKey, band), '1'); } catch { /* ignore */ }
    forceUpdate((n) => n + 1);
  }, [moduleKey, band]);

  const handleComplete = useCallback(() => {
    setCleanupTick((n) => n + 1);
    onCleanupComplete?.();
  }, [onCleanupComplete]);

  if (!cfg || loading || !status) return null;
  if (!status.atWarning && !status.atLimit) return null;
  if (status.atWarning && dismissed) return null; // atLimit is never dismissible

  return (
    <>
      <div
        className={`rounded-xl px-4 py-3 flex items-start sm:items-center gap-3 flex-wrap ${className}`}
        style={status.atLimit
          ? { background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)' }
          : { background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)' }}
        role="status"
      >
        <TriangleAlert size={18} className={status.atLimit ? 'text-red-400 flex-shrink-0' : 'text-amber-400 flex-shrink-0'} />
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-bold ${status.atLimit ? 'text-red-300' : 'text-amber-300'}`}>
            {status.atLimit ? 'Record Limit Reached' : 'Storage limit approaching'}
          </p>
          <p className="text-xs text-white/60 mt-0.5">
            {status.count.toLocaleString('en-IN')} / {status.limit.toLocaleString('en-IN')} active {pluralize(cfg.recordLabel, status.count)} used.
            {' '}
            {status.atLimit
              ? 'New records cannot be added until space is created.'
              : 'You are approaching the maximum active-record limit — review your records and remove older data to make room for new ones.'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setModalOpen(true)}
            className="h-9 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 text-black"
            style={{ background: status.atLimit ? '#f87171' : '#fbbf24' }}
          >
            <Settings2 size={13} /> Manage Records
          </button>
          {!status.atLimit && (
            <button onClick={dismiss} aria-label="Dismiss" className="w-8 h-8 rounded-lg flex items-center justify-center text-white/45 hover:bg-white/10">
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      <CapacityCleanupModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        moduleKey={moduleKey}
        demoMode={demoMode}
        actorEmail={actorEmail}
        ctx={ctx}
        capacityStatus={status}
        onComplete={handleComplete}
      />
    </>
  );
}
