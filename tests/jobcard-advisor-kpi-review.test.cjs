/**
 * tests/jobcard-advisor-kpi-review.test.cjs — Job Cards architecture review:
 * Section 1 grid alignment, KPI/status data integrity, and the demo seed that feeds
 * both. Print/PDF selection-scope coverage lives in jobcard-phaseb.test.cjs alongside
 * the rest of the bulk-action tests; this file covers what that one doesn't.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const jc = fs.readFileSync(path.resolve(__dirname, '../components/jobcards/JobCardModule.jsx'), 'utf8');
const ui = fs.readFileSync(path.resolve(__dirname, '../constants/ui.js'), 'utf8');
const seed = fs.readFileSync(path.resolve(__dirname, '../lib/demoGarageSeed.js'), 'utf8');
const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');

console.log('\nJob Cards — Service Advisor alignment, KPI integrity, seed data review\n');

// ── Issue 1: Section 1 grid alignment ───────────────────────────────────────
// Root cause was structural, not a missing margin: Job Card No.'s Auto/Manual toggle
// sits between its label and input with nothing shaped like a real intake typo in
// Service Advisor's cell, so CSS Grid's default top-anchored content left the two
// inputs at different heights despite both cells being stretched to the same row
// height. Fixed via a reusable `sub` slot Service Advisor fills with an INVISIBLE
// clone of the exact same toggle markup — real browser-computed height, not a guess.
ok('Field gained a `sub` slot (label → sub → input), not a one-off margin/offset', /function Field\(\{ label, req, error, errorId, sub, children \}\)/.test(jc) && /\{sub && <div className="mb-1\.5">\{sub\}<\/div>\}/.test(jc));
ok('Job Card No. passes its Auto/Manual toggle through `sub`', /<Field label="Job Card No\." error=\{showErr\('jobNo'\)\} errorId="err-jobNo" sub=\{jobNoModeToggle\}>/.test(jc));
ok('Service Advisor reserves the SAME height via an invisible clone of that toggle, not a hardcoded pixel value', /<Field label="Service Advisor" req sub=\{<div className="invisible" aria-hidden="true">\{jobNoModeToggle\}<\/div>\}>/.test(jc));
ok('the toggle markup is defined ONCE and reused by both fields (no drift between the real and invisible copies)', /const jobNoModeToggle = \(/.test(jc) && (jc.match(/\{jobNoModeToggle\}/g) || []).length >= 2);

// ── Issue 2: KPI data integrity — centralized bucket logic ─────────────────
// Before: kpis (the tile counts) and kpiPass (what a tile click filters the table to)
// were two independently hand-written copies of the same 7 predicates. Editing one
// without the other — exactly what happened when 'Open' needed to start excluding
// drafts — would have silently let a tile's number and its own click-through drift
// apart. Centralized into one function both now call.
ok('one shared jobMatchesKpiBucket(jc, bucket, todayMs) — not two independent copies of the same predicates', /function jobMatchesKpiBucket\(jc, bucket, todayMs\)/.test(jc));
ok('kpis (tile counts) calls the shared function, does not re-implement the predicates inline', /for \(const bucket of KPI_BUCKET_KEYS\) if \(jobMatchesKpiBucket\(jc, bucket, todayMs\)\) k\[bucket\] \+= 1;/.test(jc));
ok('kpiPass (tile-click table filter) calls the SAME shared function', /const kpiPass = \(jc\) => !kpiFilter \|\| jobMatchesKpiBucket\(jc, kpiFilter, todayMs\);/.test(jc));
ok('a draft (Save Draft — "nothing enters the workshop queue yet") is excluded from every KPI bucket, including Open', /if \(jc\.isDraft\) return false;/.test(jc));
ok('Delivered Today reads the statusLog\'s own Delivered entry timestamp against local start-of-day, not just status === Delivered', /if \(s !== 'Delivered'\) return false;[\s\S]{0,160}filter\(\(l\) => l\.status === 'Delivered'\)\.pop\(\)/.test(jc));

// ── Status vocabulary: one source, not a per-file copy ──────────────────────
// The demo seed had ALREADY drifted from the real workflow (see below) — the fix is
// structural: both the component and the seed now import the same array instead of
// each maintaining their own copy that can silently diverge again.
ok('constants/ui.js exports the canonical 13-status workflow (single source of truth)', /export const JOB_CARD_STATUSES = \[/.test(ui) && (ui.match(/JOB_CARD_STATUSES = \[([^\]]*)\]/)[1].match(/'/g) || []).length === 26); // 13 quoted strings = 26 quote chars
ok('JobCardModule imports STATUSES from constants/ui instead of hardcoding its own copy', /import \{ statusColor, SEMANTIC, JOB_CARD_STATUSES, JOB_CARD_DRAFT_STATUS \} from '\.\.\/\.\.\/constants\/ui'/.test(jc) && /const STATUSES = JOB_CARD_STATUSES;/.test(jc));

// ── Demo seed: the actual root cause of Inspection/Waiting Parts/Repair/Cancelled
// always reading 0 — the seed generated status from its OWN stale 4-value list
// (including 'Work In Progress', never a real status), so those buckets had zero
// underlying data, not a bug in the KPI math itself. ─────────────────────────────
ok('demo seed no longer hardcodes its own status list — imports the real one', /import \{ JOB_CARD_STATUSES \} from '\.\.\/constants\/ui'/.test(seed));
ok('the stale, never-valid "Work In Progress" status is gone from the generator (only survives in an explanatory comment)', !/pick\(\['Delivered', 'Delivered', 'Ready', 'Work In Progress', 'Received'\]\)/.test(seed));
ok('every real status is reachable — a weighted table covering all 13, not a 4-value stand-in', /const STATUS_WEIGHTS = \[/.test(seed) && /\['Cancelled', \d+\]/.test(seed) && /\['Quality Check', \d+\]/.test(seed) && /\['Waiting Parts', \d+\]/.test(seed) && /\['Repair Started', \d+\]/.test(seed));
ok('statusLog is built from the actual workflow path to the target status, not a single hardcoded Received entry regardless of status', /function buildStatusLog\(status, intakeAt, rnd, nowMs\)/.test(seed) && /for \(let i = 1; i <= targetIdx; i \+= 1\)/.test(seed));
ok('a slice of Delivered cards are deliberately dated within today\'s window, so Delivered Today has real data in a fresh demo session', /status === 'Delivered' && rnd\(\) < 0\.3/.test(seed));
ok('cards still mid-workflow get a recent intake date instead of a stale months-old one', /TERMINAL_STATUSES\.has\(status\) \? Math\.floor\(rnd\(\) \* 180\) : Math\.floor\(rnd\(\) \* 14\)/.test(seed));

// ── Cache-busting: the seed shape changed (status vocabulary + statusLog entries),
// which is exactly what DEMO_SCHEMA exists to catch — without bumping it, every
// browser that already ran the old seed keeps the stale 'Work In Progress' data
// forever (localStorage survives a code deploy). ────────────────────────────────
ok('DEMO_SCHEMA was bumped so existing sessions actually get re-seeded with the fix, not just fresh ones', /const DEMO_SCHEMA = 'v4-jobcard-real-statuses';/.test(dash));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
