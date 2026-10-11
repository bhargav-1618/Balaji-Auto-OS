/**
 * tests/use-labelled-control.test.cjs
 *
 * QA A11Y-003 — RUNTIME test of components/common/useLabelledControl.js, the hook that ties
 * a form helper's visible <label> to its input. Mounts the REAL hook in jsdom through a
 * Field-shaped component identical to the five helpers that use it, and checks the DOM:
 * the label must be the input's accessible name, with no duplicate ids and nothing broken.
 */
require('./setup.cjs');
const React = require('react');
const { render, cleanup } = require('@testing-library/react');
const useLabelledControl = require('../components/common/useLabelledControl').default;

let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const h = React.createElement;

// Same shape as Billing `Field` / Customers `F` / Job Cards `Field` / Vehicles `WField`.
function Field({ label, children, error }) {
  const { id, content } = useLabelledControl(children);
  return h('div', null, h('label', { htmlFor: id }, label), content, error ? h('p', null, error) : null);
}
// What a screen reader would use: a <label for> pointing at the control's id.
const nameOf = (el) => {
  if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
  const l = el.id && el.ownerDocument.querySelector(`label[for="${el.id}"]`);
  return l ? l.textContent : '';
};

console.log('\nuseLabelledControl — label becomes the accessible name\n');

let r = render(h(Field, { label: 'Phone' }, h('input', { placeholder: '10-digit' })));
let input = r.container.querySelector('input');
ok('a plain <input> gets an id', !!input.id);
ok('the label points at it (htmlFor === id)', r.container.querySelector('label').htmlFor === input.id);
ok('so the visible caption — not the placeholder — is its accessible name', nameOf(input) === 'Phone');
cleanup();

r = render(h(Field, { label: 'Notes' }, h('textarea', { placeholder: 'x' })));
ok('works for <textarea>', nameOf(r.container.querySelector('textarea')) === 'Notes');
cleanup();

r = render(h(Field, { label: 'Fuel' }, h('select', null, h('option', null, 'Petrol'))));
ok('works for <select>', nameOf(r.container.querySelector('select')) === 'Fuel');
cleanup();

console.log('\nIt never breaks what is already there\n');

r = render(h(Field, { label: 'GST' }, h('input', { id: 'my-own-id', 'aria-describedby': 'gst-err' })));
input = r.container.querySelector('input');
ok('an existing id is kept (error/aria wiring using it still works)', input.id === 'my-own-id');
ok('…and the label points at that id', r.container.querySelector('label').htmlFor === 'my-own-id');
ok('other attributes are preserved', input.getAttribute('aria-describedby') === 'gst-err');
cleanup();

r = render(h(Field, { label: 'Customer', error: 'Required' }, [h('input', { key: 'a' }), h('p', { key: 'b' }, 'helper text')]));
ok('children given as an array: the control is found, siblings render untouched', !!r.container.querySelector('input').id && r.container.textContent.includes('helper text'));
ok('the error still renders', r.container.textContent.includes('Required'));
cleanup();

r = render(h(Field, { label: 'Make' }, h('button', { type: 'button' }, 'Pick…')));
ok('a custom/non-native child (e.g. MiniSelect trigger) is left alone: no htmlFor, no id forced onto it', !r.container.querySelector('button').id && !r.container.querySelector('label').hasAttribute('for'));
cleanup();

r = render(h(Field, { label: 'Hidden' }, h('input', { type: 'hidden' })));
ok('hidden inputs are never labelled', !r.container.querySelector('input').id);
cleanup();

r = render(h(Field, { label: 'Pick' }, h('input', { type: 'checkbox' })));
ok('checkbox/radio keep their own aria-label (a field caption would mislabel a row checkbox)', !r.container.querySelector('input').id);
cleanup();

r = render(h(Field, { label: 'Empty' }, null));
ok('no children at all renders without throwing', r.container.querySelector('label') !== null && !r.container.querySelector('label').hasAttribute('for'));
cleanup();

console.log('\nMany fields on one screen\n');
r = render(h('div', null,
  h(Field, { label: 'A' }, h('input')),
  h(Field, { label: 'B' }, h('input')),
  h(Field, { label: 'C' }, h('input')),
  h(Field, { label: 'D' }, h('input')),
));
const ids = [...r.container.querySelectorAll('input')].map((i) => i.id);
ok('every field gets an id', ids.every(Boolean));
ok('ids are all different (no duplicate-id violation)', new Set(ids).size === ids.length, ids.join(','));
ok('each label names its own input', [...r.container.querySelectorAll('input')].map(nameOf).join('') === 'ABCD');
// Re-render with new props must keep the id stable (it is derived from useId).
const before = ids.join();
r.rerender(h('div', null, h(Field, { label: 'A' }, h('input')), h(Field, { label: 'B' }, h('input')), h(Field, { label: 'C' }, h('input')), h(Field, { label: 'D' }, h('input'))));
ok('ids stay stable across re-renders (focus/aria are not disturbed)', [...r.container.querySelectorAll('input')].map((i) => i.id).join() === before);
cleanup();

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
