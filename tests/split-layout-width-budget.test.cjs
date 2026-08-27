/**
 * tests/split-layout-width-budget.test.cjs
 *
 * UNIVERSAL ISSUE U1/U2 — superseded the original fix this file used to assert.
 *
 * History: the original fix (documented in the previous version of this file) gave the
 * ONE shared page shell (<main> in InventoryDashboard.js) a wider max-width, but only for
 * the `customers`/`vehicles` tabs (the only two DetailsPanel consumers at the time) —
 * every other tab (Job Cards, Billing, Inventory, Suppliers, Sales/Services/Stock In/Out,
 * Analytics, Reports, Alerts, Reminders, Dashboard) stayed capped at max-w-7xl (1280px).
 * That left the same dead-margin gap on every OTHER tab, and even missed `jobcards`
 * despite it sharing the identical split table+panel layout shape as customers/vehicles —
 * an oversight, not an intentional distinction, since the exception list had to be
 * remembered and updated by hand for every new tab.
 *
 * A follow-up architectural review (this pass) additionally found that coupling the width
 * cap to <main> itself — which is also the app's ONE page-level scroll container
 * (overflow-y-auto) — meant the native scrollbar always sat at the edge of whichever box
 * was capped, not the true viewport edge, reproducing a smaller version of the same "dead
 * space" bug on any monitor wide enough to exceed the cap (the old fix only measured/fixed
 * this at 1920px).
 *
 * Fix: <main> now owns ONLY scrolling (overflow-y-auto, no width classes at all) so its
 * scrollbar always sits at the true available-viewport edge on any monitor size. A plain,
 * non-scrolling <div> immediately inside it owns width-capping/centering (mx-auto max-w-
 * none 2xl:max-w-[1800px]) UNCONDITIONALLY — every tab gets it, with no per-tab exception
 * list to maintain or forget.
 *
 * Full-Workspace Settings Layout review: Settings used to be the one tab that opted out
 * with a blanket lg:max-w-2xl on its whole content column, regardless of which section was
 * active — a Business Profile form with 11 fields and a Security panel with 5 got the
 * identical narrow cap, which is what actually produced the "large unused workspace"
 * complaint (the cap wasn't sized to content, it was sized to the narrowEST section).
 * Settings now decides width PER SECTION instead of once for the whole page:
 * SETTINGS_WIDE_SECTIONS (business/billing/jobcards/users/backup/demoperms — sections with
 * multiple real field-groups) render as a responsive card grid using the full column;
 * everything else stays capped at SETTINGS_CARD_MAX so a 4-field card doesn't stretch
 * edge-to-edge across an 1800px canvas. The column itself no longer caps anything.
 *
 * New Invoice workspace-width review: SHELL_WIDTH_CLS moved OUT of this file, into
 * constants/ui.js (the app's shared design-tokens file) — Billing's full-screen invoice
 * editor is a Portal overlay rendered outside <main> entirely, so it could never reach a
 * constant local to InventoryDashboard.js. It now imports the same shared constant instead
 * of falling back to its own narrower modal-dialog width. This file's own usages become
 * import-and-use rather than a local declaration; see billing-invoice-workspace-width.test.cjs
 * for the Billing-side half of this fix.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nWorkspace width architecture — universal budget, scroll decoupled from width cap\n');

const inv = R('components/InventoryDashboard.js');
const uiConstants = R('constants/ui.js');
const detailsPanel = R('components/common/DetailsPanel.jsx');
const cust = R('components/customers/CustomersModule.jsx');
const veh = R('components/vehicles/VehiclesModule.jsx');

// --- The ONE shared page shell, not a per-page adjustment ---
ok('exactly one <main> page-shell element exists (the fix lives in ONE shared place)',
  (inv.match(/<main id=\{APP_SCROLL_ID\}/g) || []).length === 1);

// --- <main> owns ONLY scrolling now — no width/centering classes on it at all ---
ok('<main> has no mx-auto/max-w/padding classes — it is purely the scroll container',
  /<main id=\{APP_SCROLL_ID\}[^>]*className="relative z-10 flex-1 min-h-0 overflow-y-auto"/.test(inv));

// --- Width-capping lives on a separate, non-scrolling wrapper, applied unconditionally ---
ok('the single SHELL_WIDTH_CLS constant now lives in constants/ui.js (reachable by Portal-rendered views too, not just <main>)',
  /export const SHELL_WIDTH_CLS = 'max-w-none 2xl:max-w-\[1800px\]';/.test(uiConstants));
ok('InventoryDashboard.js imports SHELL_WIDTH_CLS rather than re-declaring it locally',
  /import \{ SEMANTIC, SHELL_WIDTH_CLS, statusColor \} from '\.\.\/constants\/ui';/.test(inv) &&
  !/const SHELL_WIDTH_CLS = /.test(inv));
ok('a dedicated inner wrapper div owns width-capping/centering via that constant, unconditionally (no activeTab ternary)',
  /<div className=\{`mx-auto w-full \$\{SHELL_WIDTH_CLS\} px-4 sm:px-6 py-6 pb-20 md:pb-6`\}>/.test(inv));
// UNIVERSAL PAGE HEADER STANDARDIZATION: the second sticky bar this used to check
// alignment against (the contextual Add Part/Add Supplier <header>) is gone entirely —
// folded into each view's own PageHeader action (see tests/global-sticky-header.test.cjs).
// The account bar is now the ONLY sticky bar left that needs to align to the shared
// width constant.
ok('the account bar aligns to the shared width constant, not its own independent literal',
  (inv.match(/\$\{SHELL_WIDTH_CLS\} mx-auto flex items-center/g) || []).length === 1);

// --- The old per-tab exception model is fully gone, not just hidden ---
ok('no per-tab width ternary remains anywhere (the old customers/vehicles-only exception)',
  !/\['customers', 'vehicles'\]\.includes\(activeTab\)/.test(inv));
ok('max-w-7xl is no longer used as a shell/tab width default anywhere in the app',
  !/max-w-7xl/.test(inv));

// --- Full-Workspace Settings Layout: per-SECTION width, not a blanket page-level cap ---
ok('Settings\' content column itself no longer caps width — it takes the shell\'s full budget like every other tab',
  /lg:flex-1 lg:min-w-0 space-y-4/.test(inv) && !/lg:flex-1 lg:min-w-0 lg:max-w-2xl/.test(inv));
ok('a shared, named width-tier decides per-section width instead of scattered magic numbers',
  /const SETTINGS_CARD_MAX = 'max-w-3xl';/.test(inv) &&
  /const SETTINGS_WIDE_SECTIONS = new Set\(\['business', 'billing', 'jobcards', 'users', 'backup', 'demoperms'\]\);/.test(inv));
ok('multi-group sections (Business Profile, Billing, Job Cards, Users & Roles, Backup & Data) render as a responsive card grid, not one giant single-column card',
  /const SETTINGS_GROUP_GRID = 'grid grid-cols-1 xl:grid-cols-2 gap-4';/.test(inv) &&
  (inv.match(/className=\{SETTINGS_GROUP_GRID\}/g) || []).length >= 5);
ok('small sections (Inventory/Notifications/Appearance/Security/About) are wrapped in the shared cap, not a per-section magic max-width',
  (inv.match(/<div className=\{SETTINGS_CARD_MAX\}>/g) || []).length >= 5);
// Card titles now route through lib/i18n.js's t('key', 'English fallback') for
// localization — the literal English string is still the second argument, so the
// same four-card grouping is still verifiable, just through the translated form.
ok('Business Profile is grouped into Business Identity / Operational / Regional / Branding, not one flat field list (the brief\'s own worked example)',
  /Card title=\{t\('settings\.businessIdentity\.title', 'Business Identity'\)\}/.test(inv) && /Card title=\{t\('settings\.operational\.title', 'Operational Settings'\)\}/.test(inv) &&
  /Card title=\{t\('settings\.regional\.title', 'Regional Settings'\)\}/.test(inv) && /Card title=\{t\('settings\.branding\.title', 'Branding'\)\}/.test(inv));
ok('the save bar\'s width matches whichever tier the active section uses, instead of a fixed unrelated width',
  /className=\{`sticky bottom-0 flex items-center justify-between gap-3 rounded-2xl px-4 py-3 \$\{SETTINGS_WIDE_SECTIONS\.has\(section\) \? '' : SETTINGS_CARD_MAX\}`\}/.test(inv));
ok('the shell-level comment above <main> no longer describes Settings as the one per-tab exception (it now shares the same unconditional budget)',
  !/Settings constrains its OWN content column instead \(see SettingsView's/.test(inv) &&
  /a per-SECTION content decision, not a per-PAGE exception to this/.test(inv));

// --- The row's own responsive math (that this fix hands a bigger budget to) is untouched ---
ok('the table column still shares row width via a flex-grow ratio (absorbs whatever budget the row is given, proportionally)',
  /xl:flex-\[2_1_0%\] xl:min-w-\[640px\]/.test(cust));
ok('the DetailsPanel default width is still responsive (a flex-grow ratio with bounds), not a flat pixel value',
  /xl:flex-\[1_1_0%\] xl:min-w-\[320px\] xl:max-w-\[480px\]/.test(detailsPanel));
ok('Vehicles keeps the same responsive table/panel math (unaffected by the shell width change)',
  /xl:flex-\[2_1_0%\] xl:min-w-0/.test(veh));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
