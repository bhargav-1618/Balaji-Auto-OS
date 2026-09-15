/**
 * tests/durableopid-collision-execution.test.cjs
 *
 * PHASE 29 (PH29-01) — EXECUTES THE REAL `lib/durableOpId.js` (not a model) in
 * isolated fake browsing contexts with a fake window / sessionStorage /
 * BroadcastChannel, and runs the tab-duplication attack + the non-regressions.
 *
 * `lib/durableOpId.js` has NO imports and uses only `export function` — the
 * `export` keyword is stripped and the module is evaluated with injected globals.
 * The BroadcastChannel bus delivers ASYNCHRONOUSLY (a queued task, matching the
 * platform) — this is exactly why the real collision watch cannot infinite-loop
 * (by the time an echo lands, the re-mint is done).
 *
 * "Duplicate tab" is SIMULATED here by cloning BOTH window.name AND sessionStorage
 * into the second context — the worst case. The real Chrome gesture was not
 * available (see docs/testing/PHASE_29_PH29-01_VALIDATION.md); this proves what
 * the shipped code does IF a browser carries window.name into a duplicate.
 */
const fs = require('fs');
const path = require('path');

const NEW_SRC = fs.readFileSync(path.resolve(__dirname, '../lib/durableOpId.js'), 'utf8');

function toCjs(src) {
  const names = [];
  let out = src.replace(/^export\s+(function|const|let)\s+([A-Za-z0-9_$]+)/gm, (m, kw, n) => { names.push(n); return `${kw} ${n}`; });
  return out + `\n;module.exports = { ${names.join(', ')} };\n`;
}

function makeBus() {
  const channels = new Map();
  const queue = [];
  return {
    register(name, bc) { if (!channels.has(name)) channels.set(name, new Set()); channels.get(name).add(bc); },
    unregister(name, bc) { const s = channels.get(name); if (s) s.delete(bc); },
    post(name, sender, data) { queue.push({ name, sender, data }); },
    async drain() {
      let spins = 0;
      while (queue.length) {
        if (spins++ > 5000) throw new Error('BUS DID NOT SETTLE — infinite loop in the collision watch');
        const { name, sender, data } = queue.shift();
        const s = channels.get(name);
        if (s) for (const bc of Array.from(s)) {
          if (bc === sender || bc._closed) continue;
          try { bc.onmessage && bc.onmessage({ data: JSON.parse(JSON.stringify(data)) }); } catch (e) { console.error('onmessage threw:', e); }
        }
        await new Promise((r) => setImmediate(r));
      }
      return spins;
    },
    liveChannels() { let n = 0; for (const s of channels.values()) for (const bc of s) if (!bc._closed) n++; return n; },
  };
}

function makeContext(bus, { windowName = '', session = {} } = {}) {
  const evl = {};
  const win = {
    _n: String(windowName || ''),
    get name() { return this._n; }, set name(v) { this._n = String(v); },
    addEventListener(ev, fn) { (evl[ev] = evl[ev] || []).push(fn); },
    removeEventListener(ev, fn) { if (evl[ev]) evl[ev] = evl[ev].filter((f) => f !== fn); },
  };
  const store = { ...session };
  const sessionStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; },
  };
  class BC {
    constructor(name) { this._name = name; this._closed = false; this.onmessage = null; bus.register(name, this); }
    postMessage(data) { if (this._closed) throw new Error('channel closed'); bus.post(this._name, this, data); }
    close() { this._closed = true; bus.unregister(this._name, this); }
  }
  const ctx = { win, sessionStorage, store, firePagehide() { (evl.pagehide || []).slice().forEach((fn) => fn({})); } };
  ctx.load = (src, { withBC = true } = {}) => {
    const fn = new Function('module', 'exports', 'window', 'sessionStorage', 'localStorage', 'BroadcastChannel', toCjs(src) + '\n;return module.exports;');
    const module = { exports: {} };
    return fn(module, module.exports, win, sessionStorage, {}, withBC ? BC : undefined);
  };
  return ctx;
}

// backend idempotency-marker model (payments[].id): a duplicate delivery is swallowed
function marker() {
  const ids = new Set();
  return { apply: (id, amt) => (ids.has(id) ? { applied: 0, dup: true } : (ids.add(id), { applied: amt, dup: false })), has: (id) => ids.has(id) };
}

let PASS = 0, FAIL = 0, NOTE = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const note = (n) => { NOTE++; console.log(`  ⚠ ${n}`); };

(async () => {
  console.log('\nPhase 29 (PH29-01) — durableOpId collision watch: EXECUTED against the real source\n');

  // ── same-tab RELOAD (no live sibling) — Phase 5b refresh-safety MUST hold ──
  {
    const bus = makeBus();
    const A = makeContext(bus); const mA = A.load(NEW_SRC); await bus.drain();
    const op1 = mA.readOrCreateOpId('payment:INV-1', 'p');
    const carriedName = A.win.name, carriedSession = { ...A.store };
    A.firePagehide(); await bus.drain();                          // real unload
    const R = makeContext(bus, { windowName: carriedName, session: carriedSession });
    const mR = R.load(NEW_SRC); await bus.drain();
    ok('same-tab reload KEEPS its page-instance id (no false re-mint, no live sibling)', R.win.name === carriedName);
    ok('same-tab reload REUSES the in-flight opId → reload+retry dedupes (Phase 5b/6b intact)', mR.readOrCreateOpId('payment:INV-1', 'p') === op1);
    ok('same-tab reload still reports hadPending (the "check the record" banner still shows)', !!mR.peekOpId('payment:INV-1'));
  }

  // ── SIMULATED "Duplicate tab": window.name + sessionStorage BOTH cloned ──
  {
    const bus = makeBus();
    const A = makeContext(bus); const mA = A.load(NEW_SRC); await bus.drain();
    const piA0 = A.win.name;
    const opA = mA.readOrCreateOpId('payment:INV-1', 'p');
    const mk = marker(); mk.apply(opA, 500);                       // A's ₹500 committed
    const B = makeContext(bus, { windowName: A.win.name, session: { ...A.store } });
    const mB = B.load(NEW_SRC); await bus.drain();                 // collision watch settles
    const opB = mB.readOrCreateOpId('payment:INV-1', 'p');         // B: a DIFFERENT ₹700 payment
    const rB = mk.apply(opB, 700);
    ok('Duplicate Tab (window.name cloned): the duplicate re-minted a DISTINCT page-instance id', B.win.name !== piA0 && B.win.name.startsWith('ph7b:pi:'));
    ok('Duplicate Tab: the original also converged to a distinct id (A.pi !== B.pi)', A.win.name !== B.win.name);
    ok('Duplicate Tab: the duplicate gets a FRESH opId — inherited one NOT reused (opB !== opA)', opB !== opA);
    ok('Duplicate Tab: B\'s ₹700 is NOT swallowed as a duplicate (PH7-01 stays closed even with window.name cloned)', rB.dup === false && rB.applied === 700);
  }

  // ── genuinely SEPARATE new tab → its own distinct id, no spurious collision ──
  {
    const bus = makeBus();
    const A = makeContext(bus); const mA = A.load(NEW_SRC); await bus.drain();
    const piA = A.win.name; const opA = mA.readOrCreateOpId('payment:INV-1', 'p');
    const N = makeContext(bus, { windowName: '', session: {} });   // never shared anything
    N.load(NEW_SRC); await bus.drain();
    ok('separate new tab mints its own page-instance id (distinct from the first tab)', N.win.name !== piA && N.win.name.startsWith('ph7b:pi:'));
    ok('a separate (non-duplicate) tab does NOT cause the original to re-mint (no spurious collision)', A.win.name === piA);
    ok('the original\'s opId is unchanged by a separate tab opening', mA.readOrCreateOpId('payment:INV-1', 'p') === opA);
  }

  // ── 2-tab & 3-tab convergence: settles, distinct ids, no identity thrashing ──
  {
    const bus = makeBus();
    const A = makeContext(bus); A.load(NEW_SRC); await bus.drain();
    const B = makeContext(bus, { windowName: A.win.name, session: { ...A.store } }); B.load(NEW_SRC);
    const s2 = await bus.drain();
    ok('2-tab collision settles (no infinite loop)', s2 < 50);
    ok('2-tab: A and B end on distinct ids', A.win.name !== B.win.name);
    const a0 = A.win.name, b0 = B.win.name; await bus.drain();
    ok('2-tab: a 2nd drain after convergence changes nothing (no identity thrashing)', A.win.name === a0 && B.win.name === b0);

    const bus3 = makeBus();
    const A3 = makeContext(bus3); A3.load(NEW_SRC); await bus3.drain();
    const B3 = makeContext(bus3, { windowName: A3.win.name, session: { ...A3.store } }); B3.load(NEW_SRC); await bus3.drain();
    const C3 = makeContext(bus3, { windowName: A3.win.name, session: { ...A3.store } }); C3.load(NEW_SRC);
    const s3 = await bus3.drain();
    const ids = [A3.win.name, B3.win.name, C3.win.name];
    ok('3-tab collision settles (no infinite loop)', s3 < 200);
    ok('3-tab: all three end pairwise-distinct', new Set(ids).size === 3);
    const snap = [...ids]; await bus3.drain();
    ok('3-tab: a 2nd drain changes nothing (converged)', JSON.stringify([A3.win.name, B3.win.name, C3.win.name]) === JSON.stringify(snap));
  }

  // ── BroadcastChannel is closed on pagehide (no leaked channel) ──
  {
    const bus = makeBus();
    const A = makeContext(bus); A.load(NEW_SRC); await bus.drain();
    const before = bus.liveChannels();
    A.firePagehide(); await bus.drain();
    ok('the collision-watch BroadcastChannel is closed on pagehide (no leak)', before >= 1 && bus.liveChannels() === 0);
  }

  // ── BroadcastChannel UNAVAILABLE → degrades to the Phase 7b window.name check ──
  {
    const bus = makeBus();
    const A = makeContext(bus); const mA = A.load(NEW_SRC, { withBC: false }); await bus.drain();
    const opA = mA.readOrCreateOpId('payment:INV-1', 'p');
    const nm = A.win.name, ss = { ...A.store };
    const R = makeContext(bus, { windowName: nm, session: ss });
    ok('no BroadcastChannel: same-tab reload STILL reuses the opId (window.name check alone)',
      R.load(NEW_SRC, { withBC: false }).readOrCreateOpId('payment:INV-1', 'p') === opA);
    const D = makeContext(bus, { windowName: A.win.name, session: { ...A.store } });
    ok('no BroadcastChannel: a duplicate w/ cloned window.name falls back to Phase-7b behaviour — NO WORSE than before the fix (documented degraded path)',
      D.load(NEW_SRC, { withBC: false }).readOrCreateOpId('payment:INV-1', 'p') === opA);
  }

  // ── RESIDUAL 8a — the ORIGINAL loses its own in-flight continuity after the collision ──
  {
    const bus = makeBus();
    const A = makeContext(bus); const mA = A.load(NEW_SRC); await bus.drain();
    const op1 = mA.readOrCreateOpId('payment:INV-1', 'p');        // pinned by the open modal
    const mk = marker(); mk.apply(op1, 500);                       // committed, ack lost
    const B = makeContext(bus, { windowName: A.win.name, session: { ...A.store } }); B.load(NEW_SRC);
    await bus.drain();                                             // collision → A ALSO re-mints
    // A's still-open modal keeps op1 (React ref) — its CURRENT op is fine:
    ok('8a: A\'s already-open modal keeps op1 (pin is a React ref) → its current op still dedupes', mk.apply(op1, 500).dup === true);
    // A closes + reopens the modal — useDurableOpId order is peekOpId THEN readOrCreateOpId:
    const hp = mA.peekOpId('payment:INV-1');
    const opReopen = mA.readOrCreateOpId('payment:INV-1', 'p');
    const mk2 = marker(); mk2.apply(op1, 500);                     // pretend op1 HAD committed
    const rDouble = mk2.apply(opReopen, 500);
    note(`RESIDUAL 8a (documented, NOT a regression fail): after a collision re-mint, a MODAL REOPEN in the ORIGINAL sees hadPending=${!!hp} and mints opId ${opReopen === op1 ? '(same)' : '(FRESH)'} — if the original op had committed, a retry then applies it AGAIN (double: ₹${mk2.applied || (rDouble.applied ? 500 + 500 : 500)}). Same rarity class as PH29-01; the OLD Phase-7b impl did NOT have this. See PHASE_29_PH29-01_VALIDATION.md.`);
    ok('8a: the residual is exactly "original re-mints → modal reopen → no banner + fresh opId" (characterised, not silent)',
      !hp && opReopen !== op1 && rDouble.dup === false);
  }

  // ── normal retry idempotency (no duplicate) is untouched ──
  {
    const bus = makeBus();
    const A = makeContext(bus); const mA = A.load(NEW_SRC); await bus.drain();
    const mk = marker();
    const op1 = mA.readOrCreateOpId('payment:INV-1', 'p'); mk.apply(op1, 500);
    const r2 = mk.apply(mA.readOrCreateOpId('payment:INV-1', 'p'), 500);
    ok('normal retry (no duplicate) recovers the SAME opId → deduped', r2.dup === true);
    mA.clearOpId('payment:INV-1');
    const r3 = mk.apply(mA.readOrCreateOpId('payment:INV-1', 'p'), 300);
    ok('after clearOpId (confirmed success) a genuine 2nd payment gets a fresh opId & applies', r3.dup === false && r3.applied === 300);
  }

  console.log(`\n  ${PASS} passed, ${FAIL} failed, ${NOTE} documented residual note(s)\n`);
  process.exit(FAIL ? 1 : 0);
})();
