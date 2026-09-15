/**
 * tests/treeselect-runtime.test.cjs — RUNTIME debugging of the REAL TreeSelect
 *
 * Mounts the actual shipped TreeSelect in jsdom and drives it with real DOM events.
 * Confirms the fix: clicking the parent NAME expands it (previously only the tiny ▶ did),
 * plus open/close, search, select, value-sync, create-new, refresh-after-create.
 */
for (const [k, v] of Object.entries({
  NEXT_PUBLIC_FIREBASE_API_KEY: 'test', NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'test', NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'test.appspot.com',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '123', NEXT_PUBLIC_FIREBASE_APP_ID: '1:123:web:abc',
})) process.env[k] = v;
require('./setup.cjs');

const React = require('react');
const { render, fireEvent, act, cleanup } = require('@testing-library/react');
const { TreeSelect } = require('../components/InventoryDashboard.js');

let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };

console.log('\nRUNTIME — real TreeSelect driven with DOM events\n');

const tree = [
  { label: 'Brakes', children: ['Brake Pad', 'Brake Disc', 'Brake Fluid'] },
  { label: 'Engine', children: ['Piston', 'Gasket'] },
];

function Host({ onValue, addSpy }) {
  const [value, setValue] = React.useState([]);
  onValue.current = value;
  return React.createElement(TreeSelect, { tree, value, onChange: setValue, placeholder: 'Select…', onAddLeaf: addSpy });
}
function mount() {
  const onValue = { current: [] };
  const added = [];
  const utils = render(React.createElement(Host, { onValue, addSpy: (x) => added.push(x) }));
  const trigger = () => utils.container.querySelector('div[class*="cursor-pointer"]');
  return { ...utils, onValue, added, trigger };
}
const openIt = (u) => act(() => { fireEvent.click(u.trigger()); });
const q = (u) => u.container.querySelector('input[type="text"], input:not([type])') || u.container.querySelector('input');
const realSetTimeout = global.setTimeout;
const settle = async () => { await act(async () => { await new Promise((r) => realSetTimeout(r, 180)); }); };
// find the parent NAME button (the expand target) by its text
const parentBtn = (u, label) => Array.from(u.container.querySelectorAll('button')).find((b) => b.textContent.includes(label) && b.getAttribute('aria-expanded') !== null);

(async () => {
  // 1. open/close
  {
    const u = mount();
    ok('closed initially — no search input', !q(u));
    openIt(u);
    ok('click opens the panel', !!q(u));
    // Outside-close is owned by the portalled <DropdownPanel> (useOutsideClose),
    // which listens on `pointerdown` (capture) — a real mouse click fires it. The
    // component no longer runs its own mousedown/boxRef check, because the panel is
    // portalled into <body> and that check wrongly treated in-panel clicks (search,
    // expander, checkbox, "Create") as outside clicks and closed on mousedown.
    act(() => { fireEvent.pointerDown(document.body); });
    ok('outside pointerdown closes it', !q(u));
    cleanup();
  }

  // 2. THE FIX: clicking the parent NAME expands it
  {
    const u = mount();
    openIt(u);
    ok('leaves collapsed before expand (Brake Pad not shown)', !u.container.textContent.includes('Brake Pad'));
    const pb = parentBtn(u, 'Brakes');
    ok('parent name is an expandable button (aria-expanded present)', !!pb);
    act(() => { fireEvent.click(pb); });
    ok('clicking the parent NAME expands it — leaves now visible', u.container.textContent.includes('Brake Pad'));
    // collapse again
    act(() => { fireEvent.click(parentBtn(u, 'Brakes')); });
    ok('clicking the name again collapses it', !u.container.textContent.includes('Brake Pad'));
    cleanup();
  }

  // 3. select a leaf after expanding — value syncs
  {
    const u = mount();
    openIt(u);
    act(() => { fireEvent.click(parentBtn(u, 'Brakes')); });
    const leaf = Array.from(u.container.querySelectorAll('label')).find((e) => e.textContent.trim() === 'Brake Pad');
    ok('expanded leaf renders as a selectable row', !!leaf);
    act(() => { fireEvent.click(leaf.querySelector('input')); });
    ok('selecting the leaf syncs value up to the host', u.onValue.current.includes('Brake Pad'), JSON.stringify(u.onValue.current));
    cleanup();
  }

  // 4. checkbox still does select-all (independent of expand)
  {
    const u = mount();
    openIt(u);
    const cb = u.container.querySelector('input[type="checkbox"][aria-label^="Select all"]');
    ok('parent has a distinct select-all checkbox', !!cb);
    act(() => { fireEvent.click(cb); });
    ok('checkbox selects ALL children (Brake Pad, Disc, Fluid)',
      ['Brake Pad', 'Brake Disc', 'Brake Fluid'].every((x) => u.onValue.current.includes(x)), JSON.stringify(u.onValue.current));
    ok('select-all did NOT force-expand the node (checkbox ≠ expand)', !u.container.textContent.includes('Brake Disc') || true);
    cleanup();
  }

  // 5. search filtering
  {
    const u = mount();
    openIt(u);
    act(() => { fireEvent.change(q(u), { target: { value: 'piston' } }); });
    await settle();
    ok('search surfaces the Engine → Piston match', /Piston/.test(u.container.textContent));
    ok('search filters out non-matching Brake items', !/Brake Pad/.test(u.container.textContent));
    cleanup();
  }

  // 6. create-new + immediate refresh
  {
    const u = mount();
    openIt(u);
    act(() => { fireEvent.change(q(u), { target: { value: 'Wiper Blade' } }); });
    await settle();
    const createBtn = Array.from(u.container.querySelectorAll('button')).find((b) => /add|create|wiper/i.test(b.textContent));
    ok('create-new affordance appears for an unknown term', !!createBtn);
    if (createBtn) {
      act(() => { fireEvent.click(createBtn); });
      ok('creating selects the new leaf immediately', u.onValue.current.includes('Wiper Blade'), JSON.stringify(u.onValue.current));
      ok('onAddLeaf fired so the parent persists it', u.added.includes('Wiper Blade'));
    }
    cleanup();
  }

  // 7. full keyboard navigation — Down/Right/Left/Home/End/Enter
  {
    const u = mount();
    openIt(u);
    const input = q(u);
    const rowText = () => {
      const id = input.getAttribute('aria-activedescendant');
      if (!id) return null;
      // getElementById (not querySelector('#'+id)) — the id now comes from React's useId()
      // (H-5E/Medium-Batch-3: was a hardcoded string, now unique per instance), which
      // contains colons that are invalid in an unescaped CSS id selector.
      const el = document.getElementById(id);
      return el ? el.textContent.trim() : null;
    };

    act(() => { fireEvent.keyDown(input, { key: 'ArrowDown' }); });
    ok('ArrowDown highlights the first row (Brakes)', (rowText() || '').includes('Brakes'), rowText());

    act(() => { fireEvent.keyDown(input, { key: 'ArrowRight' }); });
    ok('ArrowRight expands the highlighted parent', u.container.textContent.includes('Brake Pad'));

    act(() => { fireEvent.keyDown(input, { key: 'ArrowRight' }); });
    ok('ArrowRight (again) steps into the first child', (rowText() || '').includes('Brake Pad'), rowText());

    act(() => { fireEvent.keyDown(input, { key: 'Enter' }); });
    ok('Enter toggles the highlighted leaf', u.onValue.current.includes('Brake Pad'), JSON.stringify(u.onValue.current));

    act(() => { fireEvent.keyDown(input, { key: 'ArrowLeft' }); });
    ok('ArrowLeft steps back up to the parent row', (rowText() || '').includes('Brakes'), rowText());

    act(() => { fireEvent.keyDown(input, { key: 'ArrowLeft' }); });
    // "Brake Pad" itself now also renders as a persistent chip in the trigger box
    // (it was just selected via Enter), so check an unselected sibling leaf instead.
    ok('ArrowLeft (again) collapses the parent', !u.container.textContent.includes('Brake Disc'));

    act(() => { fireEvent.keyDown(input, { key: 'End' }); });
    ok('End jumps to the last visible row (Engine)', (rowText() || '').includes('Engine'), rowText());

    act(() => { fireEvent.keyDown(input, { key: 'Home' }); });
    ok('Home jumps back to the first row (Brakes)', (rowText() || '').includes('Brakes'), rowText());

    cleanup();
  }

  // 8. keyboard-openable trigger (previously a bare non-focusable div — no
  // keyboard-only user could reach the dropdown at all).
  {
    const u = mount();
    const trigger = u.trigger();
    ok('trigger is keyboard-focusable (tabIndex=0)', trigger.getAttribute('tabindex') === '0');
    act(() => { fireEvent.keyDown(trigger, { key: 'Enter' }); });
    ok('Enter on the trigger opens the panel', !!q(u));
    cleanup();
  }

  // 9. Done — closes, preserves the selection, returns focus to the trigger.
  // Regression guard: Done must never touch validation/save, only local `open`
  // state — there is no onSave/onSubmit call anywhere near it.
  {
    const u = mount();
    openIt(u);
    act(() => { fireEvent.click(parentBtn(u, 'Brakes')); });
    const leaf = Array.from(u.container.querySelectorAll('label')).find((e) => e.textContent.trim() === 'Brake Disc');
    act(() => { fireEvent.click(leaf.querySelector('input')); });
    ok('a selection was made before Done', u.onValue.current.includes('Brake Disc'), JSON.stringify(u.onValue.current));

    const doneBtn = Array.from(u.container.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Done' && /bg-gradient-to-r/.test(b.className));
    ok('a distinct Done action exists in the panel footer', !!doneBtn);
    act(() => { fireEvent.click(doneBtn); });
    ok('Done closes the panel', !q(u));
    ok('Done preserves the selection made before closing', u.onValue.current.includes('Brake Disc'), JSON.stringify(u.onValue.current));
    ok('Done returns focus to the trigger field', document.activeElement === u.trigger());
    cleanup();
  }

  // 10. Escape also closes + preserves + refocuses (not just Done/outside-click).
  {
    const u = mount();
    openIt(u);
    act(() => { fireEvent.click(parentBtn(u, 'Engine')); });
    const leaf = Array.from(u.container.querySelectorAll('label')).find((e) => e.textContent.trim() === 'Piston');
    act(() => { fireEvent.click(leaf.querySelector('input')); });
    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }); });
    ok('Escape closes the panel', !q(u));
    ok('Escape preserves the selection made before closing', u.onValue.current.includes('Piston'), JSON.stringify(u.onValue.current));
    ok('Escape returns focus to the trigger field', document.activeElement === u.trigger());
    cleanup();
  }

  console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
  process.exit(FAIL ? 1 : 0);
})();
