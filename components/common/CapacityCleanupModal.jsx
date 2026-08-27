// components/common/CapacityCleanupModal.jsx
//
// THE capacity-cleanup wizard — one implementation, reused by every applicable module
// (Job Cards, Billing, Purchase Orders, Stock In, Stock Out, Sales/Services). A module
// wires it in with just a moduleKey; this file owns the entire choose → preview →
// (export →) confirm → run → result flow, and the two safety guarantees the product
// brief calls non-negotiable:
//
//   1. The user always explicitly picks the cleanup method — nothing here ever runs
//      automatically just because the limit was reached.
//   2. Export+Delete is atomic from the user's perspective: the delete step is
//      physically a different function call, made only after the export call returned
//      without throwing (see services/capacityService.js's exportAndDeleteRecords —
//      export failure never reaches the delete step at all).
import React, { useState, useCallback, useMemo } from 'react';
import {
  Trash2, Download, Archive, TriangleAlert, CheckCircle2, XCircle, Loader2, ChevronRight,
} from 'lucide-react';
import Modal from '../Modal';
import {
  getCleanupPreview, exportRecordsToExcel, deleteRecords, archiveRecords, exportAndDeleteRecords,
  CAPACITY_MODULES, CLEANUP_BATCH_SIZE,
} from '../../services/capacityService';
import { allowedCleanupMethods } from '../../constants/capacity';
import { SEMANTIC, RADIUS } from '../../constants/ui';
import { pluralize } from '../../lib/format';
import notify from './notify';

const METHODS = [
  {
    id: 'delete',
    icon: Trash2,
    title: 'Delete Oldest 1,000',
    blurb: 'Permanently remove the oldest eligible records. This cannot be undone.',
    tone: SEMANTIC.danger,
  },
  {
    id: 'export_delete',
    icon: Download,
    title: 'Export to Excel & Delete',
    blurb: 'Save a full backup first, then remove the exported records. Recommended if you want a copy.',
    tone: SEMANTIC.info,
  },
  {
    id: 'archive',
    icon: Archive,
    title: 'Archive Oldest 1,000',
    blurb: 'Move records out of the active list but keep them accessible in history. The safer long-term choice.',
    tone: SEMANTIC.ok,
  },
];

const btnBase = `h-11 px-4 ${RADIUS.control} text-sm font-bold flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed`;

export default function CapacityCleanupModal({
  open, onClose, moduleKey, demoMode, actorEmail, ctx, capacityStatus, onComplete,
}) {
  const cfg = CAPACITY_MODULES[moduleKey];
  const methods = useMemo(() => {
    const allowed = new Set(allowedCleanupMethods(moduleKey));
    return METHODS.filter((m) => allowed.has(m.id));
  }, [moduleKey]);
  const [step, setStep] = useState('choose'); // choose | preview | exporting | confirmDelete | working | result
  const [method, setMethod] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [workingLabel, setWorkingLabel] = useState('');
  const [result, setResult] = useState(null); // { ok, message, count }
  const [exportedOk, setExportedOk] = useState(false);

  const reset = useCallback(() => {
    setStep('choose'); setMethod(null); setPreview(null); setResult(null); setExportedOk(false);
  }, []);

  const close = useCallback(() => {
    reset();
    onClose?.();
  }, [onClose, reset]);

  const pickMethod = async (id) => {
    setMethod(id);
    setStep('preview');
    setPreviewLoading(true);
    try {
      const p = await getCleanupPreview(moduleKey, { demoMode, ctx });
      setPreview(p);
    } catch (e) {
      console.error('[capacity] preview failed:', e);
      setResult({ ok: false, message: 'Could not load records for cleanup. No changes were made.' });
      setStep('result');
    } finally {
      setPreviewLoading(false);
    }
  };

  const runDelete = async () => {
    setStep('working');
    setWorkingLabel(`Deleting ${preview.eligibleCount.toLocaleString('en-IN')} ${pluralize(cfg.recordLabel, preview.eligibleCount)}…`);
    try {
      const { count } = await deleteRecords(moduleKey, preview.eligible, { demoMode, actorEmail });
      setResult({ ok: true, message: `${count.toLocaleString('en-IN')} records deleted successfully.`, count });
      notify.deleted(`${count.toLocaleString('en-IN')} ${pluralize(cfg.recordLabel, count)} deleted successfully.`);
      onComplete?.();
    } catch (e) {
      console.error('[capacity] delete failed:', e);
      setResult({ ok: false, message: 'Unable to complete cleanup. No records were deleted.' });
      notify.error('Unable to complete cleanup. No records were deleted.');
    }
    setStep('result');
  };

  const runArchive = async () => {
    setStep('working');
    setWorkingLabel(`Archiving ${preview.eligibleCount.toLocaleString('en-IN')} ${pluralize(cfg.recordLabel, preview.eligibleCount)}…`);
    try {
      const { count } = await archiveRecords(moduleKey, preview.eligible, { demoMode, actorEmail });
      setResult({ ok: true, message: `${count.toLocaleString('en-IN')} records archived successfully.`, count });
      notify.success(`${count.toLocaleString('en-IN')} ${pluralize(cfg.recordLabel, count)} archived successfully.`);
      onComplete?.();
    } catch (e) {
      console.error('[capacity] archive failed:', e);
      setResult({ ok: false, message: 'Unable to complete cleanup. No records were archived.' });
      notify.error('Unable to complete cleanup. No records were archived.');
    }
    setStep('result');
  };

  const runExportOnly = async () => {
    setStep('exporting');
    try {
      await exportRecordsToExcel(moduleKey, preview.eligible);
      setExportedOk(true);
      setStep('confirmDelete');
    } catch (e) {
      console.error('[capacity] export failed:', e);
      setResult({ ok: false, message: 'Excel export failed. No records were deleted — nothing was touched.' });
      notify.error('Export failed. No records were deleted.');
      setStep('result');
    }
  };

  // The export already succeeded; the user may still decide NOT to delete. That's a
  // legitimate, safe outcome — they keep the backup and their active data is untouched.
  const cancelAfterExport = () => {
    setResult({ ok: true, message: 'Excel file saved. No records were deleted — your active data is unchanged.' });
    setStep('result');
  };

  const runConfirmedDelete = async () => {
    // The export already happened and succeeded (see runExportOnly). This step deletes
    // EXACTLY that same record set — never re-derives "oldest N" a second time, so a
    // record created between export and confirm can never be caught in the delete.
    setStep('working');
    setWorkingLabel(`Deleting ${preview.eligibleCount.toLocaleString('en-IN')} exported ${pluralize(cfg.recordLabel, preview.eligibleCount)}…`);
    try {
      const { count } = await deleteRecords(moduleKey, preview.eligible, { demoMode, actorEmail });
      setResult({ ok: true, message: `${count.toLocaleString('en-IN')} records exported and deleted successfully.`, count });
      notify.exported(`${count.toLocaleString('en-IN')} ${pluralize(cfg.recordLabel, count)} exported and deleted successfully.`);
      onComplete?.();
    } catch (e) {
      console.error('[capacity] post-export delete failed:', e);
      setResult({ ok: false, message: 'The Excel backup was saved, but the delete step failed. Your records are safe and still active — nothing was lost.' });
      notify.error('Delete step failed after export. No records were removed.');
    }
    setStep('result');
  };

  if (!open || !cfg) return null;

  return (
    <Modal open={open} onClose={close} title={`Free up space — ${cfg.label}`} size="lg" bodyClassName="p-5 space-y-4">
      {step === 'choose' && (
        <>
          {capacityStatus && (
            <div
              className="rounded-xl p-3 text-sm"
              style={capacityStatus.atLimit
                ? { background: 'rgba(248,113,113,0.1)', border: `1px solid ${SEMANTIC.danger}40` }
                : { background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)' }}
            >
              <p className="font-bold text-white">{capacityStatus.count.toLocaleString('en-IN')} / {capacityStatus.limit.toLocaleString('en-IN')} active records</p>
              <p className="text-white/60 text-xs mt-0.5">
                {capacityStatus.atLimit
                  ? 'This dataset has reached the maximum active-record limit. New records can’t be added until space is created. Choose how you want to free space:'
                  : `Approaching the limit (${capacityStatus.remaining.toLocaleString('en-IN')} remaining). Freeing space now is optional but avoids being blocked later. Choose how you want to free space:`}
              </p>
            </div>
          )}
          <div className="space-y-2">
            {methods.map((m) => (
              <button
                key={m.id}
                onClick={() => pickMethod(m.id)}
                className={`w-full text-left p-3.5 ${RADIUS.control} border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] transition flex items-center gap-3`}
              >
                <span className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: `${m.tone}1f`, color: m.tone }}>
                  <m.icon size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-white">{m.title}</span>
                  <span className="block text-xs text-white/50 mt-0.5">{m.blurb}</span>
                </span>
                <ChevronRight size={16} className="text-white/45 flex-shrink-0" />
              </button>
            ))}
          </div>
        </>
      )}

      {step === 'preview' && (
        <PreviewStep
          loading={previewLoading}
          preview={preview}
          method={method}
          cfg={cfg}
          onBack={() => setStep('choose')}
          onConfirmDelete={runDelete}
          onConfirmArchive={runArchive}
          onStartExport={runExportOnly}
        />
      )}


      {step === 'exporting' && (
        <WorkingStep label={`Exporting oldest ${preview?.eligibleCount?.toLocaleString('en-IN')} ${pluralize(cfg.recordLabel, preview?.eligibleCount ?? 2)}…`} />
      )}

      {step === 'confirmDelete' && (
        <ConfirmDeleteStep preview={preview} cfg={cfg} exportedOk={exportedOk} onCancel={cancelAfterExport} onConfirm={runConfirmedDelete} />
      )}

      {step === 'working' && <WorkingStep label={workingLabel} />}

      {step === 'result' && (
        <ResultStep result={result} onDone={close} />
      )}
    </Modal>
  );
}

function PreviewStep({ loading, preview, method, cfg, onBack, onConfirmDelete, onConfirmArchive, onStartExport }) {
  if (loading || !preview) {
    return <WorkingStep label="Finding the oldest eligible records…" />;
  }
  const { eligibleCount, protectedCount, protectedSamples, dateRangeLabel, scannedCount } = preview;
  const nothingEligible = eligibleCount === 0;

  return (
    <div className="space-y-4">
      <div className={`rounded-xl p-3.5 ${RADIUS.control}`} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)' }}>
        <p className="text-sm font-bold text-white">
          Oldest {eligibleCount.toLocaleString('en-IN')} {pluralize(cfg.recordLabel, eligibleCount)}
          {eligibleCount < CLEANUP_BATCH_SIZE && eligibleCount > 0 && <span className="text-white/45 font-normal"> (fewer than {CLEANUP_BATCH_SIZE.toLocaleString('en-IN')} are eligible right now)</span>}
        </p>
        <p className="text-xs text-white/60 mt-1">Date range: <span className="font-semibold text-white/80">{dateRangeLabel}</span></p>
        <p className="text-xs text-white/60">Module: <span className="font-semibold text-white/80">{cfg.label}</span></p>
        {protectedCount > 0 && (
          <div className="mt-2 pt-2 border-t border-white/10">
            <p className="text-xs text-amber-300 flex items-center gap-1.5"><TriangleAlert size={13} /> {protectedCount.toLocaleString('en-IN')} older record{protectedCount === 1 ? '' : 's'} skipped — still required by an active business process.</p>
            {protectedSamples?.length > 0 && (
              <ul className="mt-1 ml-5 list-disc text-[11px] text-white/45 space-y-0.5">
                {protectedSamples.map((s) => <li key={s.id}>{s.id}: {s.reason}</li>)}
              </ul>
            )}
          </div>
        )}
        <p className="text-[11px] text-white/45 mt-2">Scanned {scannedCount.toLocaleString('en-IN')} of the oldest records to find these.</p>
      </div>

      {nothingEligible ? (
        <div className="rounded-xl p-3 text-sm text-white/60" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)' }}>
          None of the oldest records are eligible for cleanup right now — they&apos;re all still required by an active business process. No action can be taken until some of them close out naturally.
        </div>
      ) : method === 'delete' ? (
        <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)' }}>
          <p className="font-bold text-red-300">This action is permanent.</p>
          <p className="text-white/60 text-xs mt-1">These {eligibleCount.toLocaleString('en-IN')} records will be permanently removed from the active dataset. This cannot be undone. You can instead export them first, or archive them.</p>
        </div>
      ) : method === 'archive' ? (
        <div className="rounded-xl p-3 text-sm text-white/60" style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.25)' }}>
          These {eligibleCount.toLocaleString('en-IN')} records will be moved out of the active dataset but preserved for historical access — reachable from the Archived view.
        </div>
      ) : (
        <div className="rounded-xl p-3 text-sm text-white/60" style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.25)' }}>
          A real Excel file will be generated and downloaded first. Deletion only happens after that file is confirmed created — if the export fails, nothing is deleted.
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <button onClick={onBack} className={`${btnBase} bg-white/5 border border-white/10 text-white/70 hover:bg-white/10`}>Cancel</button>
        {!nothingEligible && (
          method === 'delete' ? (
            <button onClick={onConfirmDelete} className={`${btnBase} text-white`} style={{ background: SEMANTIC.danger }}>
              <Trash2 size={15} /> Delete {eligibleCount.toLocaleString('en-IN')} Record{eligibleCount === 1 ? '' : 's'}
            </button>
          ) : method === 'archive' ? (
            <button onClick={onConfirmArchive} className={`${btnBase} text-black`} style={{ background: SEMANTIC.ok }}>
              <Archive size={15} /> Archive {eligibleCount.toLocaleString('en-IN')} Record{eligibleCount === 1 ? '' : 's'}
            </button>
          ) : (
            <button onClick={onStartExport} className={`${btnBase} text-black`} style={{ background: '#d4af37' }}>
              <Download size={15} /> Export {eligibleCount.toLocaleString('en-IN')} Records
            </button>
          )
        )}
      </div>
    </div>
  );
}

function ConfirmDeleteStep({ preview, cfg, exportedOk, onCancel, onConfirm }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl p-3.5 flex items-start gap-2.5" style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)' }}>
        <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-emerald-300">Excel successfully created.</p>
          <p className="text-xs text-white/60 mt-0.5">{preview.eligibleCount.toLocaleString('en-IN')} {pluralize(cfg.recordLabel, preview.eligibleCount)} ({preview.dateRangeLabel}) were saved to your downloads.</p>
        </div>
      </div>
      <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)' }}>
        <p className="font-bold text-red-300">Confirm permanent deletion.</p>
        <p className="text-white/60 text-xs mt-1">These exact {preview.eligibleCount.toLocaleString('en-IN')} exported records will now be permanently removed from the active dataset. This cannot be undone — but you already have the Excel backup.</p>
      </div>
      <div className="flex items-center justify-between gap-2">
        <button onClick={onCancel} className={`${btnBase} bg-white/5 border border-white/10 text-white/70 hover:bg-white/10`}>Cancel — Keep Records</button>
        <button onClick={onConfirm} className={`${btnBase} text-white`} style={{ background: SEMANTIC.danger }}>
          <Trash2 size={15} /> Delete Exported Records
        </button>
      </div>
    </div>
  );
}

function WorkingStep({ label }) {
  return (
    <div className="py-10 flex flex-col items-center justify-center gap-3 text-center">
      <Loader2 size={28} className="animate-spin text-[#d4af37]" />
      <p className="text-sm text-white/70">{label}</p>
    </div>
  );
}

function ResultStep({ result, onDone }) {
  const ok = result?.ok;
  return (
    <div className="py-6 flex flex-col items-center justify-center gap-3 text-center">
      {ok ? <CheckCircle2 size={32} className="text-emerald-400" /> : <XCircle size={32} className="text-red-400" />}
      <p className="text-sm font-semibold text-white max-w-sm">{result?.message}</p>
      <button onClick={onDone} className={`${btnBase} mt-2 text-black`} style={{ background: '#d4af37' }}>Done</button>
    </div>
  );
}
