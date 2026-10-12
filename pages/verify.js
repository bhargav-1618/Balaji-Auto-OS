// pages/verify.js
// Public invoice / job-card verification page — the target of the PDF QR code.
//
// TWO KINDS OF LINK
//  1. /verify?id=<32 hex>   — NEW. The id points at a minimal record the workshop's own staff created
//     in Firestore when the PDF was generated (lib/verification.js). The page fetches that ONE
//     record by its exact id and shows the workshop's own data, so a link cannot be edited to
//     claim a different invoice, amount or status. Only the id is in the URL.
//  2. /verify?no=…&c=…&t=…&s=… — LEGACY (already-printed QR codes, and PDFs made offline / in demo).
//     These carry their details in the URL and anyone can type one, so the page shows them under a
//     prominent "NOT VERIFIED" notice and never styles them as confirmed/paid.
//
// (Security audit SEC-04: this page used to print any URL it was given as if it were a confirmed
// invoice — e.g. a forged "PAID" page on the workshop's own domain.)
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { VERIFY_ID_RE } from '../lib/verification';
import { lookupVerificationRecord } from '../lib/verificationClient';

const GOLD = '#d4af37';
const MUTED = 'rgba(255,255,255,0.68)';     // >= 4.5:1 on the #141414 card
const FAINT = 'rgba(255,255,255,0.6)';

const money = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const asOf = (ms) => {
  if (!ms) return '';
  try { return new Date(ms).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return ''; }
};
const first = (q) => (Array.isArray(q) ? q[0] : q);

function Shell({ title, children }) {
  return (
    <>
      <Head>
        <title>{title} · Sri Baba Balaji Maruti Care</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        {/* the link holds the record id: never leak it to other sites through the Referer header */}
        <meta name="referrer" content="no-referrer" />
      </Head>
      <main style={{ minHeight: '100vh', background: '#0b0b0b', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'var(--font-montserrat), system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
        <div style={{ width: '100%', maxWidth: 440, borderRadius: 20, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.10)', background: '#141414' }}>
          <div style={{ background: '#1a1a1a', padding: '22px 20px', textAlign: 'center', borderBottom: `2px solid ${GOLD}` }}>
            <h1 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: GOLD, letterSpacing: 0.4 }}>SRI BABA BALAJI MARUTI CARE</h1>
            <p style={{ margin: '6px 0 0', fontSize: 10, color: MUTED, letterSpacing: 1 }}>PREMIUM AUTOMOTIVE SERVICE &amp; DIAGNOSTICS</p>
          </div>
          {children}
        </div>
      </main>
    </>
  );
}

function Message({ heading, body, tone, action }) {
  const colour = tone === 'bad' ? '#f87171' : tone === 'warn' ? '#fbbf24' : '#fff';
  return (
    <div style={{ padding: 28, textAlign: 'center' }} role={tone === 'bad' || tone === 'warn' ? 'alert' : 'status'}>
      <p style={{ fontSize: 15, fontWeight: 700, margin: 0, color: colour }}>{heading}</p>
      <p style={{ fontSize: 12, color: MUTED, marginTop: 8, lineHeight: 1.6 }}>{body}</p>
      {action}
    </div>
  );
}

function Details({ heading, rows, badge, badgeTone, footer, banner }) {
  const tone = badgeTone === 'good'
    ? { bg: 'rgba(52,211,153,0.15)', fg: '#34d399' }
    : badgeTone === 'neutral'
      ? { bg: 'rgba(255,255,255,0.10)', fg: 'rgba(255,255,255,0.85)' }
      : { bg: 'rgba(251,191,36,0.15)', fg: '#fbbf24' };
  return (
    <div style={{ padding: 20 }}>
      {banner}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>{heading}</span>
        {badge && (
          <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, padding: '4px 10px', borderRadius: 999, background: tone.bg, color: tone.fg }}>
            {String(badge).toUpperCase()}
          </span>
        )}
      </div>
      <dl style={{ margin: 0 }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '11px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <dt style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: FAINT }}>{label}</dt>
            <dd style={{ margin: 0, fontSize: 13, fontWeight: 700, textAlign: 'right', wordBreak: 'break-word' }}>{String(value)}</dd>
          </div>
        ))}
      </dl>
      <p style={{ fontSize: 10.5, color: FAINT, marginTop: 16, lineHeight: 1.6 }}>{footer}</p>
    </div>
  );
}

export default function VerifyPage() {
  const router = useRouter();
  // Wait for BOTH the router and the first client mount. For a statically pre-rendered page with no
  // query string Next reports isReady=true on the very first client render while the server HTML
  // said "Checking…" — rendering different text there is a React hydration mismatch (#418/#425).
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const ready = mounted && router.isReady;
  const q = router.query || {};
  const id = first(q.id);
  const { no, c, v, d, t, s, k } = q;

  // ---- NEW links: look the record up ----
  const [lookup, setLookup] = useState({ state: 'idle' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!ready || id === undefined) return undefined;
    if (typeof id !== 'string' || !VERIFY_ID_RE.test(id)) { setLookup({ state: 'invalid' }); return undefined; }
    let alive = true;
    setLookup({ state: 'loading' });
    lookupVerificationRecord(id)
      .then((r) => { if (alive) setLookup(r); })
      .catch(() => { if (alive) setLookup({ state: 'error' }); });
    return () => { alive = false; };
  }, [ready, id, attempt]);

  // ---- LEGACY links: details come from the URL itself ----
  const legacyRows = useMemo(() => ([
    [k === 'jobcard' ? 'Job Card No.' : 'Invoice No.', no],
    ['Customer', c],
    ['Vehicle', v],
    ['Date', d],
    ['Amount', money(t)],
    ['Status', s],
  ].filter(([, val]) => val !== undefined && val !== null && String(val).trim() !== '')), [no, c, v, d, t, s, k]);

  if (!ready) return <Shell title="Verify Document"><Message heading="Checking…" body="One moment." /></Shell>;

  if (id !== undefined) {
    if (lookup.state === 'idle' || lookup.state === 'loading') {
      return <Shell title="Verify Document"><Message heading="Checking with the workshop…" body="Looking up this document in the workshop’s records." /></Shell>;
    }
    if (lookup.state === 'error') {
      return (
        <Shell title="Verify Document">
          <Message tone="warn" heading="Couldn’t check right now"
            body="We couldn’t reach the workshop’s records (this is not a result about your document). Check your connection and try again, or contact the workshop."
            action={<button type="button" onClick={() => setAttempt((n) => n + 1)} style={{ marginTop: 14, padding: '9px 18px', borderRadius: 10, border: `1px solid ${GOLD}`, background: 'transparent', color: GOLD, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Try again</button>} />
        </Shell>
      );
    }
    if (lookup.state === 'invalid' || lookup.state === 'notfound') {
      return (
        <Shell title="Document not found">
          <Message tone="bad" heading="We couldn’t find this document"
            body="This link doesn’t match any document in the workshop’s records. If you were given this link, please do not rely on it — contact the workshop to confirm before paying." />
        </Shell>
      );
    }
    const r = lookup.record;
    const label = r.kind === 'jobcard' ? 'Job Card' : 'Invoice';
    const rows = [
      [`${label} No.`, r.docNo],
      ['Date', r.date],
      ['Amount', money(r.total)],
      ['Status', r.status],
    ].filter(([, val]) => val !== undefined && val !== null && String(val).trim() !== '');
    const paid = r.status.toLowerCase() === 'paid';
    return (
      <Shell title={`Verify ${r.docNo}`}>
        <Details
          heading={`${label} details`}
          rows={rows}
          badge={r.status}
          badgeTone={paid ? 'good' : 'warn'}
          banner={(
            <p style={{ margin: '0 0 14px', padding: '8px 10px', borderRadius: 8, background: 'rgba(52,211,153,0.12)', color: '#34d399', fontSize: 11, fontWeight: 700 }}>
              ✓ Matches the workshop’s records
            </p>
          )}
          footer={<>Status and amount are as of {asOf(r.updatedAtMs) || 'the last time the workshop updated this document'}. For your current balance, or if anything differs from your printed copy, please contact the workshop before paying.</>}
        />
      </Shell>
    );
  }

  if (legacyRows.length === 0) {
    return (
      <Shell title="Verify Document">
        <Message heading="Nothing to verify"
          body="This link doesn’t carry any document details. Please scan the QR code printed on your invoice or job card again, or contact the workshop." />
      </Shell>
    );
  }

  return (
    <Shell title={no ? `Verify ${no}` : 'Verify Document'}>
      <Details
        heading={`${k === 'jobcard' ? 'Job Card' : 'Invoice'} details (from the link)`}
        rows={legacyRows}
        badge={null}
        banner={(
          <div role="alert" style={{ margin: '0 0 14px', padding: '10px 12px', borderRadius: 8, background: 'rgba(251,191,36,0.14)', border: '1px solid rgba(251,191,36,0.5)', color: '#fbbf24', fontSize: 12, fontWeight: 700, lineHeight: 1.5 }}>
            NOT VERIFIED — these details were read from the link itself and have not been checked
            against the workshop’s records. Anyone can create a link like this.
          </div>
        )}
        footer="Please confirm this document with the workshop before paying. Newer invoices carry a QR code that is checked against the workshop’s records."
      />
    </Shell>
  );
}
