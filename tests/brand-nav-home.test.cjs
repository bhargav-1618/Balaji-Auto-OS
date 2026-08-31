/**
 * tests/brand-nav-home.test.cjs
 *
 * "and brand navigation" regression.
 *
 * ON THE DEPLOYED APP (reproduced): clicking the "SRI BABA BALAJI / MARUTI CARE"
 * logo + name in the sidebar did nothing — it was a plain <div>, not actionable.
 *
 * FIX: the brand is now a real <button> that calls go('overview') — the same
 * helper the nav items use, so it follows the app's existing tab + #hash routing
 * (no full page reload) and lands on the Dashboard/home (activeTab 'overview').
 * A <button> keeps Enter/Space activation and focus-visible styling for free.
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');
const React = require('react');
const { render, fireEvent, cleanup } = require('@testing-library/react');
const { Sidebar } = require('../components/InventoryDashboard.js');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');

console.log('\nbrand → home navigation\n');

// ── SOURCE ────────────────────────────────────────────────────────────────
ok('the brand block is a <button>, not the old inert <div>',
  /<button type="button" onClick=\{\(\) => go\('overview'\)\}/.test(dash) &&
  !/<div className="flex items-center gap-2 px-4 py-4 border-b border-white\/8">\s*<span[^>]*>\s*<img src="\/icons\/icon-512/.test(dash));
ok('brand navigates to the app home tab (overview), not an arbitrary module',
  /onClick=\{\(\) => go\('overview'\)\}/.test(dash));
ok('go() follows existing routing — setActiveTab + close mobile drawer, no reload',
  /const go = \(id\) => \{ setActiveTab\(id\); setMobileOpen\(false\); \};/.test(dash));
ok('brand keeps an accessible name',
  /aria-label="Go to Dashboard home"/.test(dash));
ok('brand exposes focus-visible styling for keyboard users',
  /aria-label="Go to Dashboard home"[\s\S]{0,400}focus-visible:ring/.test(dash));
ok('brand marks itself current when already on the dashboard',
  /aria-current=\{activeTab === 'overview' \? 'page' : undefined\}/.test(dash));
ok('overview is the app default/home tab',
  /useState\('overview'\)/.test(dash) && /#overview/.test(dash));

// ── BEHAVIOUR ─────────────────────────────────────────────────────────────
const calls = { tab: [], mobile: [] };
const props = {
  activeTab: 'customers',
  setActiveTab: (t) => calls.tab.push(t),
  collapsed: false,
  setCollapsed: () => {},
  mobileOpen: false,
  setMobileOpen: (v) => calls.mobile.push(v),
  isAdmin: true,
  alertCount: 0, reminderCount: 0, jobCount: 0, inventoryCount: 0,
  status: 'connected', onRetry: () => {},
};

let container;
try {
  ({ container } = render(React.createElement(Sidebar, props)));
} catch (e) {
  ok('Sidebar renders', false, e.message);
}

if (container) {
  const brand = container.querySelector('button[aria-label="Go to Dashboard home"]');
  ok('brand button is in the DOM', !!brand);
  ok('brand is a real <button> element (Enter/Space activate it natively)',
    brand && brand.tagName === 'BUTTON');
  ok('brand still shows the workshop name', brand && /SRI BABA BALAJI/.test(brand.textContent));

  if (brand) {
    fireEvent.click(brand);
    ok('clicking the brand navigates to the home tab (overview)',
      calls.tab.length === 1 && calls.tab[0] === 'overview',
      `setActiveTab calls: ${JSON.stringify(calls.tab)}`);
    ok('clicking the brand also closes the mobile drawer',
      calls.mobile.includes(false));
  }

  // keyboard: a <button> fires click on Enter/Space via the browser; assert the
  // element is focusable and not removed from the tab order.
  ok('brand is keyboard focusable (no tabIndex=-1, not disabled)',
    brand && !brand.disabled && brand.getAttribute('tabindex') !== '-1');
}

cleanup();
console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
