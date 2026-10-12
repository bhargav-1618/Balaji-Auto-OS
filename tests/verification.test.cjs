/**
 * tests/verification.test.cjs — security audit, SEC-04
 *
 * lib/verification.js (public-safe verification records) and the QR link builder, exercised with a
 * fake Firestore. The security properties under test:
 *   - the record carries ONLY the minimal public fields (no customer / vehicle / phone / costs);
 *   - drafts and unidentifiable documents never get a public record;
 *   - the id is 128 random bits from a CSPRNG, and is REUSED for the same document;
 *   - sync never creates a record for a document nobody holds a QR for;
 *   - the new QR link carries nothing but the id; anything not a valid id falls back to the legacy link;
 *   - a Firestore failure surfaces as a throw (so callers degrade) and the client wrapper never throws;
 *   - the page-facing lookup whitelists fields and reports transport errors as errors, not "not found".
 */
require('./setup.cjs');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const V = require('../lib/verification');
const { buildQrPayload } = require('../lib/pdfQr');

const ALLOWED = ['kind', 'ref', 'docNo', 'date', 'total', 'status', 'updatedAt'];

// ---- a tiny fake of the Firestore functions lib/verification.js is given -----------------------
function fakeFb({ existing = {}, failOn } = {}) {
  const store = { ...existing };           // id -> record
  const writes = [];
  const fb = {
    db: { __fake: true },
    crypto: require('crypto').webcrypto,
    serverTimestamp: () => '<<server-time>>',
    collection: (db, name) => ({ name }),
    doc: (db, coll, id) => ({ coll, id }),
    where: (f, op, v) => ({ f, op, v }),
    limit: (n) => ({ n }),
    query: (c, ...cs) => ({ c, cs }),
    getDocs: async (q) => {
      if (failOn === 'getDocs') throw new Error('network');
      const ref = q.cs.find((x) => x.f === 'ref').v; const kind = q.cs.find((x) => x.f === 'kind').v;
      const hit = Object.entries(store).filter(([, r]) => r.ref === ref && r.kind === kind).slice(0, 1);
      return { docs: hit.map(([id, r]) => ({ id, data: () => r })) };
    },
    setDoc: async (d, data) => { if (failOn === 'setDoc') throw new Error('permission-denied'); store[d.id] = data; writes.push({ id: d.id, data }); },
    getDoc: async (d) => { if (failOn === 'getDoc') throw new Error('unavailable'); const r = store[d.id]; return { exists: () => !!r, data: () => r }; },
  };
  return { fb, store, writes };
}
const INV = { kind: 'invoice', ref: 'inv_1700000000000_1234', docNo: 'INV-0042', date: '2026-10-11', total: 5899.999, status: 'Paid' };

(async () => {
  console.log('\nnewVerifyId — 128 random bits\n');
  const ids = new Set(Array.from({ length: 500 }, () => V.newVerifyId()));
  ok('500 ids are all unique', ids.size === 500);
  ok('every id is exactly 32 lowercase hex chars', [...ids].every((i) => V.VERIFY_ID_RE.test(i)));
  ok('it refuses to run without a secure random source (never falls back to Math.random)', (() => { try { V.newVerifyId({}); return false; } catch { return true; } })());
  const src = require('fs').readFileSync(require('path').resolve(__dirname, '../lib/verification.js'), 'utf8');
  ok('the module never uses Math.random (code, not comments)', !/Math\.random/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));

  console.log('\nbuildVerificationRecord — minimal and public-safe\n');
  const r = V.buildVerificationRecord(INV);
  ok('a normal invoice gives exactly kind/ref/docNo/date/total/status', JSON.stringify(Object.keys(r).sort()) === JSON.stringify(['date', 'docNo', 'kind', 'ref', 'status', 'total']));
  ok('the amount is rounded to 2 decimals', r.total === 5900);
  const leaky = V.buildVerificationRecord({ ...INV, customer: 'Ramesh Kumar', vehicle: 'AP31AB1234', phone: '9876543210', lines: [{ cost: 5 }], profit: 1, costPrice: 2, email: 'a@b.co' });
  ok('customer / vehicle / phone / lines / profit / cost / email are never copied into the record', Object.keys(leaky).every((k) => ALLOWED.includes(k)) && !JSON.stringify(leaky).match(/Ramesh|AP31|9876|cost|profit|lines/i));
  ok('a DRAFT (DRF-…) never gets a public record', V.buildVerificationRecord({ ...INV, docNo: 'DRF-0001' }) === null);
  ok('no document number => no record', V.buildVerificationRecord({ ...INV, docNo: '' }) === null && V.buildVerificationRecord({ ...INV, docNo: 'undefined' }) === null);
  ok('no internal ref => no record (it could never be found again, so every PDF would mint a new id)', V.buildVerificationRecord({ ...INV, ref: '' }) === null);
  ok('an unknown kind is rejected', V.buildVerificationRecord({ ...INV, kind: 'estimate' }) === null && V.buildVerificationRecord({ ...INV, kind: undefined }) === null);
  ok('a job card without an amount is fine (total omitted, not NaN)', (() => { const j = V.buildVerificationRecord({ kind: 'jobcard', ref: 'jc_1', docNo: 'JC-1', status: 'Ready' }); return j && !('total' in j) && j.status === 'Ready'; })());
  ok('NaN / negative / absurd amounts are dropped, not stored', ['abc', NaN, -5, 1e13, null, ''].every((t) => !('total' in V.buildVerificationRecord({ ...INV, total: t }))));
  ok('fields are trimmed and length-capped to the rules\' limits (docNo 40, status 40, ref 80)', (() => { const x = V.buildVerificationRecord({ kind: 'invoice', ref: 'r'.repeat(200), docNo: ` ${'N'.repeat(100)} `, status: 'S'.repeat(100) }); return x.ref.length === 80 && x.docNo.length === 40 && x.status.length === 40; })());
  ok('a Firestore Timestamp / Date / epoch-ms date becomes a short ISO date, never "[object Object]"',
    V.buildVerificationRecord({ ...INV, date: { toMillis: () => Date.UTC(2026, 9, 11) } }).date === '2026-10-11'
    && V.buildVerificationRecord({ ...INV, date: new Date(Date.UTC(2026, 9, 11)) }).date === '2026-10-11'
    && V.buildVerificationRecord({ ...INV, date: Date.UTC(2026, 9, 11) }).date === '2026-10-11'
    && !/object/i.test(V.buildVerificationRecord({ ...INV, date: { weird: true } }).date || ''));

  console.log('\nissueVerification — create once, reuse forever\n');
  {
    const { fb, store, writes } = fakeFb();
    const id1 = await V.issueVerification(fb, INV);
    ok('first issue creates a record under a valid random id', V.VERIFY_ID_RE.test(id1) && Object.keys(store).length === 1);
    const written = writes[0].data;
    ok('the written document has ONLY allowed keys and the server timestamp', Object.keys(written).every((k) => ALLOWED.includes(k)) && written.updatedAt === '<<server-time>>');
    const id2 = await V.issueVerification(fb, { ...INV, status: 'Unpaid' });
    ok('issuing again for the SAME document reuses the id (a printed QR keeps working)', id2 === id1 && Object.keys(store).length === 1);
    ok('...and refreshes the status', store[id1].status === 'Unpaid');
    const id3 = await V.issueVerification(fb, { ...INV, ref: 'inv_other', docNo: 'INV-0043' });
    ok('a different document gets a different id', id3 !== id1 && Object.keys(store).length === 2);
    const idJob = await V.issueVerification(fb, { kind: 'jobcard', ref: INV.ref, docNo: 'JC-1' });
    ok('an invoice and a job card with the same ref do not collide (lookup is by ref AND kind)', idJob !== id1);
    ok('an ineligible document returns null and writes nothing', (await V.issueVerification(fb, { ...INV, docNo: 'DRF-1' })) === null && Object.keys(store).length === 3);
  }
  {
    const { fb } = fakeFb({ failOn: 'setDoc' });
    let threw = false; try { await V.issueVerification(fb, INV); } catch { threw = true; }
    ok('a Firestore write failure THROWS (the caller decides how to degrade)', threw);
  }

  console.log('\nsyncVerification — refresh only, never create\n');
  {
    const { fb, store } = fakeFb();
    ok('no existing record => nothing is created', (await V.syncVerification(fb, INV)) === false && Object.keys(store).length === 0);
    const id = await V.issueVerification(fb, INV);
    ok('an existing record is refreshed in place', (await V.syncVerification(fb, { ...INV, status: 'Cancelled' })) === true && store[id].status === 'Cancelled' && Object.keys(store).length === 1);
  }

  console.log('\nlookupVerification — what the public page may show\n');
  {
    const good = 'a'.repeat(32);
    const stored = { kind: 'invoice', ref: 'inv_x', docNo: 'INV-0001', date: '2026-10-01', total: 1180, status: 'Paid', updatedAt: { toMillis: () => 1700000000000 }, customer: 'LEAK', phone: '999', secretField: 'LEAK' };
    const { fb } = fakeFb({ existing: { [good]: stored } });
    const res = await V.lookupVerification(fb, good);
    ok('a stored record is returned as state "ok"', res.state === 'ok');
    ok('only whitelisted fields leave the function (nothing extra stored can ever reach the page)', JSON.stringify(Object.keys(res.record).sort()) === JSON.stringify(['date', 'docNo', 'kind', 'status', 'total', 'updatedAtMs']) && !JSON.stringify(res).includes('LEAK') && !/inv_x/.test(JSON.stringify(res)));
    ok('the internal ref is not exposed to the page', !('ref' in res.record));
    ok('unknown id => "notfound"', (await V.lookupVerification(fb, 'b'.repeat(32))).state === 'notfound');
    ok('malformed ids are "invalid" WITHOUT touching Firestore', (await Promise.all(['', 'abc', 'A'.repeat(32), `${'a'.repeat(31)}g`, '../invoices', null, undefined, 123, ['a'.repeat(32)]].map((i) => V.lookupVerification({ ...fb, getDoc: async () => { throw new Error('should not be called'); } }, i)))).every((x) => x.state === 'invalid'));
    ok('a stored record with no docNo is treated as not found', (await V.lookupVerification(fakeFb({ existing: { [good]: { kind: 'invoice' } } }).fb, good)).state === 'notfound');
    let threw = false; try { await V.lookupVerification(fakeFb({ existing: { [good]: stored }, failOn: 'getDoc' }).fb, good); } catch { threw = true; }
    ok('a transport / permission error THROWS (the page shows "couldn\'t check", not a false "not found")', threw);
  }

  console.log('\nbuildQrPayload — the link\n');
  {
    const id = 'c0ffee00c0ffee00c0ffee00c0ffee00';
    const withId = buildQrPayload({ kind: 'invoice', docNo: 'INV-0042', customer: 'Ramesh Kumar', vehicle: 'AP31AB1234', date: '2026-10-11', total: 5900, status: 'Paid', verifyId: id });
    const u = new URL(withId);
    ok('with a verification id the link is /verify?id=<id>', u.pathname === '/verify' && u.searchParams.get('id') === id);
    ok('...and carries NOTHING else: no document number, name, vehicle, amount or status in the URL', [...u.searchParams.keys()].join() === 'id' && !/Ramesh|AP31|INV-0042|5900|Paid/.test(withId));
    ok('the link is short (a short payload keeps the QR modules big enough to scan)', withId.length < 80, String(withId.length));
    const bad = ['', 'abc', 'C0FFEE00C0FFEE00C0FFEE00C0FFEE00', `${id}0`, '../x', null, undefined, 42];
    ok('anything that is not a 32-hex id falls back to the LEGACY link (never produces a broken verify link)', bad.every((b) => { const p = new URL(buildQrPayload({ kind: 'invoice', docNo: 'INV-1', customer: 'X', verifyId: b })); return p.searchParams.get('no') === 'INV-1' && !p.searchParams.has('id'); }));
    ok('the legacy link still uses "v" for the VEHICLE — the new param is "id" so the two can never be confused', new URL(buildQrPayload({ docNo: 'INV-1', vehicle: 'AP31' })).searchParams.get('v') === 'AP31');
    ok('no document number still means no QR at all', buildQrPayload({ docNo: '', verifyId: id }) === '');
  }

  console.log('\nverificationClient — safe to call from PDF / save code\n');
  {
    const client = require('../lib/verificationClient');
    ok('demo mode never touches the database and returns null', (await client.issueVerificationId(INV, { demoMode: true })) === null);
    ok('demo mode sync is a no-op', (await client.syncVerificationRecord(INV, { demoMode: true })) === false);
    // (no test here may touch the network, so the wrapper's guarantees are asserted on its source)
    const csrc = require('fs').readFileSync(require('path').resolve(__dirname, '../lib/verificationClient.js'), 'utf8');
    ok('both write helpers wrap Firestore in try/catch + a bounded timeout, so they cannot throw or hang', (csrc.match(/try \{ return await withTimeout\(/g) || []).length === 2 && /TIMEOUT_MS = 4000/.test(csrc));
    ok('the lookup is bounded by the same timeout (an offline visitor gets "couldn\'t check", not a spinner forever)', /return withTimeout\(lookupVerification/.test(csrc));
  }

  console.log('\nwiring (source guards)\n');
  {
    const rd = (rel) => require('fs').readFileSync(require('path').resolve(__dirname, rel), 'utf8');
    const dash = rd('../components/InventoryDashboard.js'), bill = rd('../components/billing/BillingModule.jsx'), jc = rd('../components/jobcards/JobCardModule.jsx');
    ok('Billing and Job Cards are handed the SYNCED save wrappers', /onPersist=\{persistInvoiceSynced\}/.test(dash) && /onPersist=\{persistJobCardSynced\}/.test(dash));
    ok('the original persistInvoice / persistJobCard bodies are untouched (existing tests inspect them) and are not passed directly', !/onPersist=\{persistInvoice\}/.test(dash) && !/onPersist=\{persistJobCard\}/.test(dash));
    ok('the wrapper returns the ORIGINAL result and cannot change it (verification is fire-and-forget inside try/catch)',
      /const persistInvoiceSynced = async \(iv\) => \{\s*const saved = await persistInvoice\(iv\);\s*try \{[\s\S]{0,500}\} catch \{[^}]*\}\s*return saved;\s*\};/.test(dash)
      && /const persistJobCardSynced = async \(card\) => \{\s*const saved = await persistJobCard\(card\);\s*try \{[\s\S]{0,500}\} catch \{[^}]*\}\s*return saved;\s*\};/.test(dash));
    ok('the sync is skipped in demo mode and never awaited (a slow/blocked verification write cannot delay a save)', /!demoMode\) \{\s*syncVerificationRecord\(/.test(dash) && !/await syncVerificationRecord/.test(dash));
    ok('only the CUSTOMER copy of an invoice asks for a public id — the workshop copy keeps its internal link', /const verifyId = isWorkshop \? null : await issueVerificationId\(/.test(bill) && /isWorkshop \? internalLink\(\) : buildQrPayload\(/.test(bill));
    ok('Billing sends the minimal fields only (no customer / vehicle / phone) to the verification record', (() => { const m = bill.match(/issueVerificationId\(\{([^}]*)\}/); return !!m && !/customer|vehicle|phone|regNo/i.test(m[1]); })());
    ok('Job Cards send the minimal fields only', (() => { const m = jc.match(/issueVerificationId\(\{([^}]*)\}/); return !!m && !/customer|vehicle|phone|regNo/i.test(m[1]); })());
    ok('both PDF generators pass demoMode (demo documents never write to the real database)', /issueVerificationId\(\{[\s\S]{0,260}\}, \{ demoMode \}\)/.test(bill) && /issueVerificationId\(\{[\s\S]{0,260}\}, \{ demoMode \}\)/.test(jc));
    ok('the page and the link builder agree on the parameter name ("id", not the legacy vehicle param "v")', /verify\?id=/.test(rd('../lib/pdfQr.js')) && /first\(q\.id\)/.test(rd('../pages/verify.js')));
  }

  console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
