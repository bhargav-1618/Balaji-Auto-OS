// components/common/Badge.jsx
//
// THE status badge. There were four, with four different boxes:
//
//   Billing      inline hex, px-2 py-0.5 rounded-md  text-[10px]
//   Job Cards    inline hex, px-2 py-1   rounded-full text-[10px]
//   Vehicles     inline hex, px-1.5 py-0.5 rounded    text-[9px]
//   Inventory    Tailwind classes, px-2 py-0.5 rounded-full text-[10px] uppercase
//
// Same word, four different heights and radii on four pages. The COLOURS already agreed;
// only the geometry drifted. This unifies the box and leaves every colour exactly where
// it was — see constants/ui.js.
import React from 'react';
import { statusColor } from '../../constants/ui';

/**
 * @param {string} status  e.g. 'Paid', 'Delivered', 'Expired', 'Low Stock'
 * @param {string} label   display text, if it differs from the status ('30d', 'Out')
 * @param {string} color   explicit override (expiry countdowns compute their own)
 * @param {'sm'|'md'} size
 */
export default function Badge({ status, label, color, size = 'md', className = '', title, children }) {
  const c = color || statusColor(status);
  const text = label ?? status ?? children ?? '';
  if (!text) return null;

  const pad = size === 'sm' ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]';

  return (
    <span
      title={title}
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-full font-bold uppercase tracking-wider leading-none ${pad} ${className}`}
      style={{
        // 15% tint + 35% border + solid text: the ratio Inventory already used, applied
        // to the hexes the other three modules already used.
        background: `${c}26`,
        border: `1px solid ${c}59`,
        color: c,
      }}
    >
      {text}
    </span>
  );
}
