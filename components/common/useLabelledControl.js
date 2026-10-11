// components/common/useLabelledControl.js
//
// QA A11Y-003. Four form helpers (Billing `Field`, Job Cards `Field`, Customers `F`,
// Vehicles `WField`) each rendered
//
//     <label>Customer Name *</label>  {children}
//
// with the label as an UNATTACHED sibling: no `htmlFor`, no wrapping. Sighted users see the
// caption; a screen reader announces only the input's placeholder ("Enter 10 digit number,
// edit text") — the field's real name is never spoken, and once the user types, the
// placeholder is gone too. axe doesn't flag it (it accepts a placeholder as a fallback
// name), which is why the QA scan reported only the one field with no placeholder at all.
//
// This hook finds the single native control among a helper's children and gives it an id
// the <label htmlFor> can point to, so the visible caption IS the accessible name.
//
//  - Only plain <input>/<textarea>/<select> children are wired. Custom controls
//    (MiniSelect, DateTimeField, …) own their own semantics and are left untouched.
//  - A control that already has an `id` keeps it (and the label points at it), so existing
//    aria-describedby / error wiring is never broken.
//  - The FIRST native control wins; extra controls in the same helper are not relabelled.
import React, { useId } from 'react';

const NATIVE = /^(input|textarea|select)$/;
// Inputs that have no text caption to point at (the label would name a checkbox row, not a
// value field) — leave them for their own aria-label.
const SKIP_TYPES = /^(hidden|checkbox|radio)$/;

/**
 * @param {React.ReactNode} children the helper's children
 * @returns {{ id: string|undefined, content: React.ReactNode }}
 *   `id` goes on the <label htmlFor>; it is undefined when there is no native control.
 *   `content` is `children` with that id applied.
 */
export default function useLabelledControl(children) {
  const auto = useId();
  const nodes = React.Children.toArray(children);
  const target = nodes.find((n) => React.isValidElement(n) && typeof n.type === 'string' && NATIVE.test(n.type)
    && !SKIP_TYPES.test(String(n.props.type || '')));
  if (!target) return { id: undefined, content: children };
  const id = target.props.id || `fld${auto.replace(/:/g, '')}`;
  const content = nodes.map((n) => (n === target && !n.props.id ? React.cloneElement(n, { id }) : n));
  return { id, content };
}
