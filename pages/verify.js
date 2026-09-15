// pages/verify.js
// Public invoice / job-card verification page — the target of the PDF QR code.
//
// WHY: the QR previously encoded plain text ("SRI BABA BALAJI MARUTI CARE INV-0004 ...").
// A phone camera has no idea what to do with arbitrary text, so it hands it to the
// browser as a SEARCH QUERY — which is exactly the Google/Safari search the user saw.
// Encoding a real https:// URL makes both Android and iPhone cameras offer "Open link",
// so the customer lands on a page that confirms the bill instead of a search results
// page. All the invoice facts travel inside the URL, so this page works even for a
// customer who is not logged in and even if the workshop is offline.

import Head from 'next/head';
import { useRouter } from 'next/router';
import { useMemo } from 'react';

const GOLD = '#d4af37';

const money = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function VerifyPage() {
  const router = useRouter();
  // Query values arrive as strings; treat everything as untrusted display data.
  const { no, c, v, d, t, s, k } = router.query;

  const rows = useMemo(() => ([
    [k === 'jobcard' ? 'Job Card No.' : 'Invoice No.', no],
    ['Customer', c],
    ['Vehicle', v],
    ['Date', d],
    ['Amount', money(t)],
    ['Status', s],
  ].filter(([, val]) => val !== undefined && val !== null && String(val).trim() !== '')), [no, c, v, d, t, s, k]);

  const paid = String(s || '').toLowerCase() === 'paid';

  return (
    <>
      <Head>
        <title>{no ? `Verify ${no}` : 'Verify Document'} · Sri Baba Balaji Maruti Care</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
      </Head>
      <main style={{ minHeight: '100vh', background: '#0b0b0b', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
        <div style={{ width: '100%', maxWidth: 440, borderRadius: 20, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.10)', background: '#141414' }}>
          <div style={{ background: '#1a1a1a', padding: '22px 20px', textAlign: 'center', borderBottom: `2px solid ${GOLD}` }}>
            <h1 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: GOLD, letterSpacing: 0.4 }}>SRI BABA BALAJI MARUTI CARE</h1>
            <p style={{ margin: '6px 0 0', fontSize: 10, color: 'rgba(255,255,255,0.55)', letterSpacing: 1 }}>PREMIUM AUTOMOTIVE SERVICE &amp; DIAGNOSTICS</p>
          </div>

          {rows.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center' }}>
              <p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Nothing to verify</p>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 8, lineHeight: 1.6 }}>
                This link doesn’t carry any document details. Please scan the QR code printed on your
                invoice or job card again, or contact the workshop.
              </p>
            </div>
          ) : (
            <div style={{ padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>
                  {k === 'jobcard' ? 'Job Card' : 'Invoice'} details
                </span>
                {s && (
                  <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, padding: '4px 10px', borderRadius: 999, background: paid ? 'rgba(52,211,153,0.15)' : 'rgba(251,191,36,0.15)', color: paid ? '#34d399' : '#fbbf24' }}>
                    {String(s).toUpperCase()}
                  </span>
                )}
              </div>

              <dl style={{ margin: 0 }}>
                {rows.map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '11px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <dt style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: 'rgba(255,255,255,0.4)' }}>{label}</dt>
                    <dd style={{ margin: 0, fontSize: 13, fontWeight: 700, textAlign: 'right', wordBreak: 'break-word' }}>{String(value)}</dd>
                  </div>
                ))}
              </dl>

              <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.35)', marginTop: 16, lineHeight: 1.6 }}>
                These details are encoded in the QR code printed on your document. If anything here
                doesn’t match your printed copy, please contact the workshop before paying.
              </p>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
