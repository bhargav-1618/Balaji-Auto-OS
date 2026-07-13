import React from 'react';

/**
 * Toggle — the ONE switch component used everywhere in the app.
 *
 * Premium black & gold pill:
 *  - OFF: deep charcoal track, muted knob, no glow.
 *  - ON:  gold gradient track, luminous gold knob with a soft outer glow.
 *  - 200ms slide (inside the 180–220ms brief), eased.
 *  - Hover / focus-visible / active / disabled states.
 *  - Keyboard accessible: it's a real <button role="switch">, so Space/Enter
 *    activate it and aria-checked is announced. Focus ring is gold.
 *  - Honours prefers-reduced-motion (transition drops to none).
 *
 * Sizes are fixed app-wide so every toggle is identical: track 44x24, knob 20.
 * Do NOT re-implement a switch anywhere else — import this.
 *
 * Usage:
 *   <Toggle on={value} onChange={setValue} label="GST Optional" desc="…" />
 *   <Toggle on={value} onChange={setValue} aria-label="Compact sidebar" />  // bare
 */

const TRACK_W = 44;
const TRACK_H = 24;
const KNOB = 20;
const PAD = (TRACK_H - KNOB) / 2; // 2px

export function Toggle({ on, onChange, disabled = false, label, desc, id, 'aria-label': ariaLabel }) {
  const handle = () => { if (!disabled) onChange?.(!on); };

  const knob = (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: PAD,
        left: PAD,
        width: KNOB,
        height: KNOB,
        borderRadius: '9999px',
        transform: `translateX(${on ? TRACK_W - KNOB - PAD * 2 : 0}px)`,
        transition: 'transform 200ms cubic-bezier(0.4, 0.0, 0.2, 1), box-shadow 200ms ease, background 200ms ease',
        background: on
          ? 'radial-gradient(circle at 35% 30%, #fff3c4 0%, #f5d76e 35%, #d4af37 70%, #aa801e 100%)'
          : 'radial-gradient(circle at 35% 30%, #6b6b6b 0%, #4a4a4a 60%, #3a3a3a 100%)',
        boxShadow: on
          ? '0 0 10px 2px rgba(212,175,55,0.55), 0 0 2px 0 rgba(255,235,160,0.9) inset, 0 1px 2px rgba(0,0,0,0.4)'
          : '0 1px 2px rgba(0,0,0,0.5)',
      }}
    />
  );

  const track = (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={!!on}
      aria-label={ariaLabel || (typeof label === 'string' ? label : undefined)}
      disabled={disabled}
      onClick={handle}
      className="premium-toggle"
      style={{
        position: 'relative',
        flexShrink: 0,
        width: TRACK_W,
        height: TRACK_H,
        borderRadius: '9999px',
        border: on ? '1px solid rgba(212,175,55,0.55)' : '1px solid rgba(255,255,255,0.10)',
        background: on
          ? 'linear-gradient(90deg, #7a5c14 0%, #a67c1f 45%, #d4af37 100%)'
          : 'linear-gradient(90deg, #1a1a1a 0%, #242424 100%)',
        boxShadow: on ? '0 0 12px rgba(212,175,55,0.30)' : 'inset 0 1px 3px rgba(0,0,0,0.6)',
        transition: 'background 200ms ease, box-shadow 200ms ease, border-color 200ms ease',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        padding: 0,
        outline: 'none',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* The visible pill is 44x24, but a 24px-tall tap target is far too small for
          a finger (WCAG 2.5.5 / Apple HIG want ~44px). This invisible overlay grows
          the HIT AREA to 44px tall without changing the visual size or layout. */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          height: 44,
          minWidth: 44,
        }}
      />
      {knob}
    </button>
  );

  // Bare toggle (no label) — caller positions it.
  if (!label && !desc) return track;

  // Standard settings row: text on the left, toggle hard-right, never overlapping.
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="flex-1 min-w-0">
        {label && <p className="text-sm text-white/85">{label}</p>}
        {desc && <p className="text-[11px] text-white/40">{desc}</p>}
      </div>
      {track}
    </div>
  );
}

export default Toggle;
