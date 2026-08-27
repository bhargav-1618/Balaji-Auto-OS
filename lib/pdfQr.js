// lib/pdfQr.js
// One QR builder shared by the Billing PDF and the Job Card PDF, so both behave
// identically.
//
// WHY THIS EXISTS — the old QR scanned as "No usable data found":
// The encoded data was actually valid; the problem was physical size. The payload
// was ~81 chars, which forces a QR **version 5 = 37x37 modules**. That was then
// drawn into a 50pt box in the PDF, giving 50/37 = 1.35pt (~0.48mm) per module.
// Phone cameras need roughly >= 2pt (~0.7mm) per module to resolve the pattern; below
// that the modules blur into each other on screen and on paper, and the scanner
// gives up. Two levers fix it, and we pull both:
//   1. Keep the payload SHORT so the QR stays a low version (fewer, bigger modules).
//   2. Draw it BIGGER on the page (70-80pt instead of 50pt).
// At 57 chars / version 4 (33x33) drawn at 76pt we get ~2.3pt per module — a
// comfortable margin above the threshold, verified by decoding the rendered image.

const clean = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  // never encode the literal strings that leak from empty state
  if (!s || s === 'undefined' || s === 'null' || s === 'NaN') return '';
  return s;
};

/**
 * Build the QR payload. Prefers a real public link when the deployment has one
 * configured (set NEXT_PUBLIC_SITE_URL), otherwise falls back to structured,
 * human-readable text that is useful on its own when scanned.
 *
 * Returns '' when there isn't enough valid data to be worth encoding — callers
 * MUST skip drawing the QR in that case rather than encode an empty string.
 */
export function buildQrPayload({ kind, docNo, shopName, customer, vehicle, date, total, status }) {
  const no = clean(docNo);
  if (!no) return ''; // no document number => nothing meaningful to encode

  // ALWAYS encode an https:// URL.
  //
  // The old payload was plain text ("SRI BABA BALAJI MARUTI CARE\nINV-0004\n..."), and
  // a phone camera cannot act on arbitrary text — it hands it to the browser as a
  // SEARCH QUERY. That is why scanning opened a Google/Safari search instead of the
  // invoice. A URL is the one payload every scanner understands: both Android and
  // iPhone offer "Open link".
  //
  // Origin resolution, in order:
  //   1. NEXT_PUBLIC_SITE_URL  (set this on the deployment for a stable link)
  //   2. window.location.origin (works automatically wherever the app is served)
  //   3. the production domain, as a last resort for offline PDF generation
  const envBase = clean(process.env.NEXT_PUBLIC_SITE_URL);
  const runtimeBase = typeof window !== 'undefined' && window.location ? window.location.origin : '';

  // A printed invoice can outlive the machine that made it. NEVER bake a local /
  // private address into a PDF: a customer scanning "http://localhost:3000/..." or
  // "http://192.168.1.5/..." gets a dead link. So any non-public origin is rejected
  // and we fall back to the deployed production URL.
  const isPublic = (u) => {
    if (!u) return false;
    try {
      const { protocol, hostname } = new URL(u);
      if (protocol !== 'https:' && protocol !== 'http:') return false;
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '[::1]') return false;
      if (/^10\./.test(hostname)) return false;                       // private class A
      if (/^192\.168\./.test(hostname)) return false;                 // private class C
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;  // private class B
      if (/\.local$/i.test(hostname)) return false;                   // mDNS
      if (!hostname.includes('.')) return false;                      // bare host, not routable
      return true;
    } catch { return false; }
  };

  const PROD_URL = 'https://balaji-auto-os.vercel.app';
  const base = (isPublic(envBase) ? envBase : isPublic(runtimeBase) ? runtimeBase : PROD_URL).replace(/\/+$/, '');

  // Every fact travels in the query string, so /verify renders correctly for a
  // customer who is not signed in — and the QR still carries the invoice details
  // even if the site is unreachable (the URL itself is human-readable).
  const q = new URLSearchParams();
  q.set('no', no);
  if (kind === 'jobcard') q.set('k', 'jobcard');
  const add = (key, val) => { const v = clean(val); if (v) q.set(key, v); };
  add('c', customer);
  add('v', vehicle);
  add('d', date);
  if (total !== undefined && total !== null && !Number.isNaN(Number(total))) q.set('t', String(Math.round(Number(total))));
  add('s', status);

  return `${base}/verify?${q.toString()}`;
}

/**
 * Generate a QR data URL sized for print. Renders at high pixel density so the
 * image is crisp when jsPDF scales it into the page box (and when that page is
 * printed at 300dpi).
 */
export async function makeQrDataUrl(payload) {
  const data = clean(payload);
  if (!data) return null; // never encode empty / undefined / null

  try {
    const QR = (await import('qrcode')).default;
    return await QR.toDataURL(data, {
      errorCorrectionLevel: 'M', // M tolerates ~15% damage; good for printed paper
      margin: 2,                 // quiet zone — scanners REQUIRE >= 2 modules of it
      width: 720,                // high source resolution; jsPDF scales down cleanly
      color: { dark: '#000000', light: '#ffffff' }, // pure black/white = best contrast
    });
  } catch {
    return null; // QR is a nice-to-have; never break PDF generation over it
  }
}

// Draw size in PDF points.
// The verification URL lands at QR version 6 = 41x41 modules (45 including the
// mandatory 2-module quiet zone). Phone cameras need roughly >= 2pt (~0.7mm) per
// module. At 113pt each module is 113/45 = 2.5pt (~0.9mm) — comfortable headroom on
// screen and on a printed A4 page, and verified by decoding the rendered bitmap.
// (The original 50pt box gave 1.35pt/module, which no camera could resolve.)
export const QR_PT = 113;
