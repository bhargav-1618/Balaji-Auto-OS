// components/common/LocalCapacityBanner.jsx
//
// Drop-in capacity warning/blocked banner for a LOCALLY-stored (not Firestore) record
// set — see services/localCapacityService.js's header for why Alerts and Reminders get
// this instead of components/common/CapacityBanner.jsx. Same visual language, same
// 5,000/4,500 thresholds, same non-spam per-band dismissal — but only ONE cleanup method
// is offered (not three), because there is nothing meaningful to "archive" or "export" for
// a browser-local bookkeeping entry the way there is for a real Firestore business record
// (see each call site for what "record" and "eligible" mean for that module).
//
//     <LocalCapacityBanner
//       moduleKey="alerts" moduleLabel="Alerts" recordLabel="tracked alert entry"
//       status={status} getEntries={() => entries}
//       methodTitle="Remove Stale Entries" methodBlurb="..."
//       onConfirm={async (eligible) => { ...mutate...; return { count }; }}
//       onComplete={() => {...}} />
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  TriangleAlert, X, Settings2, Trash2, CheckCircle2, XCircle, Loader2, ChevronRight,
} from 'lucide-react';
import Modal from '../Modal';
import { getLocalCleanupPreview } from '../../services/localCapacityService';
import { CLEANUP_BATCH_SIZE } from '../../constants/capacity';
import { SEMANTIC, RADIUS } from '../../constants/ui';
import { pluralize } from '../../lib/format';
import notify from './notify';

const bandOf = (count) => Math.floor(count / 100) * 100;
const dismissKey = (moduleKey, band) => `capacity_dismiss_local_${moduleKey}_${band}`;

export default function LocalCapacityBanner({
  moduleKey, moduleLabel, recordLabel, status, getEntries,
  methodTitle = 'Remove Stale Entries', methodBlurb, methodIcon: MethodIcon = Trash2,
  onConfirm, onComplete, canManage = true, className = '',
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [, forceUpdate] = useState(0);

  const band = status ? bandOf(status.count) : 0;
  const dismissed = useMemo(() => {
    if (typeof window === 'undefined' || !status) return false;
    try { return sessionStorage.getItem(dismissKey(moduleKey, band)) === '1'; } catch { return false; }
  }, [moduleKey, band, status]);

  const dismiss = useCallback(() => {
    try { sessionStorage.setItem(dismissKey(moduleKey, band), '1'); } catch { /* ignore */ }
    forceUpdate((n) => n + 1);
  }, [moduleKey, band]);

  if (!status) return null;
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
            {status.count.toLocaleString('en-IN')} / {status.limit.toLocaleString('en-IN')} {pluralize(recordLabel, status.count)} tracked.
            {' '}
            {status.atLimit
              ? (canManage ? 'New entries can still be recorded, but review and clear stale entries soon.' : 'Ask an admin to clear stale entries.')
              : 'Approaching the tracked-entry limit — review and clear stale entries to make room.'}
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setModalOpen(true)}
              className="h-9 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 text-black"
              style={{ background: status.atLimit ? '#f87171' : '#fbbf24' }}
            >
              <Settings2 size={13} /> Manage {moduleLabel}
            </button>
            {!status.atLimit && (
              <button onClick={dismiss} aria-label="Dismiss" className="w-8 h-8 rounded-lg flex items-center justify-center text-white/45 hover:bg-white/10">
                <X size={15} />
              </button>
            )}
          </div>
        )}
      </div>

      {canManage && (
        <LocalCapacityCleanupModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          moduleLabel={moduleLabel}
          recordLabel={recordLabel}
          status={status}
          getEntries={getEntries}
          methodTitle={methodTitle}
          methodBlurb={methodBlurb}
          MethodIcon={MethodIcon}
          onConfirm={onConfirm}
          onComplete={onComplete}
        />
      )}
    </>
  );
}

const btnBase = `h-11 px-4 ${RADIUS.control} text-sm font-bold flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed`;

function LocalCapacityCleanupModal({
  open, onClose, moduleLabel, recordLabel, status, getEntries, methodTitle, methodBlurb, MethodIcon, onConfirm, onComplete,
}) {
  const [step, setStep] = useState('preview'); // preview | working | result
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  // Always call the LATEST getEntries without needing it in the effect's deps — it's an
  // inline prop that gets a new identity on most parent re-renders, and putting it in
  // the deps array would rebuild (and reset) the preview on every one of those while the
  // modal is open, potentially yanking the eligible/protected numbers out from under the
  // user mid-read.
  const getEntriesRef = useRef(getEntries);
  getEntriesRef.current = getEntries;

  // Build the preview exactly once per open — not on mount, and not on every render
  // while open (see above). The entry set can change between separate opens (more
  // alerts read/archived, more reminders completed since last time), so this must be an
  // effect keyed on `open`, not a one-time useState initializer.
  useEffect(() => {
    if (!open) { setStep('preview'); setPreview(null); setResult(null); return; }
    const entries = getEntriesRef.current?.() || [];
    setPreview(getLocalCleanupPreview(entries));
  }, [open]);

  const close = useCallback(() => { onClose?.(); }, [onClose]);

  const runConfirm = async () => {
    setStep('working');
    try {
      const { count } = await onConfirm(preview.eligible);
      setResult({ ok: true, message: `${count.toLocaleString('en-IN')} ${pluralize(recordLabel, count)} removed successfully.`, count });
      notify.deleted(`${count.toLocaleString('en-IN')} ${pluralize(recordLabel, count)} removed successfully.`);
      onComplete?.();
    } catch (e) {
      console.error(`[localCapacity] cleanup failed for "${moduleLabel}":`, e);
      setResult({ ok: false, message: 'Unable to complete cleanup. Nothing was removed.' });
      notify.error('Unable to complete cleanup. Nothing was removed.');
    }
    setStep('result');
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={close} title={`Free up space — ${moduleLabel}`} size="lg" bodyClassName="p-5 space-y-4">
      {step === 'preview' && (
        preview ? (
          <PreviewBody
            preview={preview}
            status={status}
            recordLabel={recordLabel}
            methodTitle={methodTitle}
            methodBlurb={methodBlurb}
            MethodIcon={MethodIcon}
            onCancel={close}
            onConfirm={runConfirm}
          />
        ) : (
          <WorkingBody label="Finding stale entries…" />
        )
      )}
      {step === 'working' && <WorkingBody label={`Removing ${preview?.eligibleCount?.toLocaleString('en-IN')} ${pluralize(recordLabel, preview?.eligibleCount ?? 2)}…`} />}
      {step === 'result' && <ResultBody result={result} onDone={close} />}
    </Modal>
  );
}

function PreviewBody({ preview, status, recordLabel, methodTitle, methodBlurb, MethodIcon, onCancel, onConfirm }) {
  const { eligibleCount, eligibleTotal, protectedCount, dateRangeLabel } = preview;
  const nothingEligible = eligibleCount === 0;
  return (
    <div className="space-y-4">
      <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)' }}>
        <p className="font-bold text-white">{status.count.toLocaleString('en-IN')} / {status.limit.toLocaleString('en-IN')} {pluralize(recordLabel, status.count)} tracked</p>
      </div>
      <div className={`rounded-xl p-3.5 ${RADIUS.control}`} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)' }}>
        <p className="text-sm font-bold text-white">
          Eligible for cleanup: {eligibleTotal.toLocaleString('en-IN')}
          {eligibleTotal > 0 && eligibleCount < eligibleTotal && <span className="text-white/45 font-normal"> (removing the oldest {eligibleCount.toLocaleString('en-IN')} of {CLEANUP_BATCH_SIZE.toLocaleString('en-IN')} this round)</span>}
        </p>
        {eligibleCount > 0 && <p className="text-xs text-white/60 mt-1">Date range: <span className="font-semibold text-white/80">{dateRangeLabel}</span></p>}
        <div className="mt-2 pt-2 border-t border-white/10">
          <p className="text-xs text-amber-300 flex items-center gap-1.5">
            <TriangleAlert size={13} /> Protected {pluralize(recordLabel, protectedCount)}: {protectedCount.toLocaleString('en-IN')} — still active or unresolved, never touched by this cleanup.
          </p>
        </div>
      </div>

      {nothingEligible ? (
        <div className="rounded-xl p-3 text-sm text-white/60" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)' }}>
          Nothing is eligible for cleanup right now — every tracked entry is still active or unresolved. No action can be taken until some of them close out naturally.
        </div>
      ) : (
        <div className="w-full text-left p-3.5 rounded-xl border border-white/10 bg-white/[0.03] flex items-center gap-3">
          <span className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: `${SEMANTIC.danger}1f`, color: SEMANTIC.danger }}>
            <MethodIcon size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-white">{methodTitle}</span>
            <span className="block text-xs text-white/50 mt-0.5">{methodBlurb}</span>
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <button onClick={onCancel} className={`${btnBase} bg-white/5 border border-white/10 text-white/70 hover:bg-white/10`}>Cancel</button>
        {!nothingEligible && (
          <button onClick={onConfirm} className={`${btnBase} text-white`} style={{ background: SEMANTIC.danger }}>
            <Trash2 size={15} /> Remove {eligibleCount.toLocaleString('en-IN')} {pluralize(recordLabel, eligibleCount)}
          </button>
        )}
      </div>
    </div>
  );
}

function WorkingBody({ label }) {
  return (
    <div className="py-10 flex flex-col items-center justify-center gap-3 text-center">
      <Loader2 size={28} className="animate-spin text-[#d4af37]" />
      <p className="text-sm text-white/70">{label}</p>
    </div>
  );
}

function ResultBody({ result, onDone }) {
  const ok = result?.ok;
  return (
    <div className="py-6 flex flex-col items-center justify-center gap-3 text-center">
      {ok ? <CheckCircle2 size={32} className="text-emerald-400" /> : <XCircle size={32} className="text-red-400" />}
      <p className="text-sm font-semibold text-white max-w-sm">{result?.message}</p>
      <button onClick={onDone} className={`${btnBase} mt-2 text-black`} style={{ background: '#d4af37' }}>Done</button>
    </div>
  );
}
