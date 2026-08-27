// components/common/NotificationRow.jsx — shared row for notification-style lists
// (Alert Center, Reminder Center). Before this, each list had independently evolved
// its own row markup: different corner radius (rounded-xl vs rounded-2xl), Alerts had
// no icon avatar while Reminders did, status chips were a stray rounded-full pill at
// the far right in Alerts vs inline next to the title in Reminders, and Alerts' actions
// were bare text/icon links with no fixed hit-target while Reminders' were uniform
// w-8 h-8 buttons. One shared row now drives both, so height/spacing/badge/action
// alignment can't drift apart between lists again.
import React from 'react';
import Badge from './Badge';

export default function NotificationRow({ icon: Icon, iconColor = '#d4af37', accentColor, title, titleChips = [], meta, muted = false, onTitleClick, actions = [] }) {
  const TitleWrap = onTitleClick ? 'button' : 'div';
  return (
    <div
      className={`rounded-2xl p-3.5 flex items-center gap-3 transition hover:bg-white/[0.05] ${muted ? 'opacity-55' : ''}`}
      style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)', borderLeft: accentColor ? `3px solid ${accentColor}` : undefined }}
    >
      {Icon && (
        <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: iconColor + '1f', color: iconColor }}>
          <Icon size={17} />
        </span>
      )}
      <TitleWrap className="min-w-0 flex-1 text-left" {...(onTitleClick ? { type: 'button', onClick: onTitleClick } : {})}>
        <p className="text-sm font-semibold text-white/90 flex items-center gap-1.5 flex-wrap">
          <span className="truncate">{title}</span>
          {titleChips.map((c, i) => (
            <Badge key={i} label={c.label} color={c.color} size="sm" className="flex-shrink-0" />
          ))}
        </p>
        {meta && <p className="text-xs text-white/50 truncate">{meta}</p>}
      </TitleWrap>
      {actions.length > 0 && (
        <div className="flex gap-1.5 flex-shrink-0">
          {actions.map((a, i) => {
            // a.className, when given, REPLACES the entire default appearance (bg/border/
            // text/hover) as one self-contained string, rather than appending to a
            // hardcoded default — Tailwind's generated stylesheet order isn't the same as
            // class-string order, so mixing e.g. a custom bg-* with a default bg-white/5 in
            // one className would make the winner unpredictable (and a fixed hover:bg-white/10
            // would flash white on hover over an intentionally-colored action button).
            const cls = `w-8 h-8 rounded-lg flex items-center justify-center transition ${a.className || 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10'}`;
            return a.href ? (
              <a key={i} href={a.href} target={a.target} rel={a.rel} title={a.title} className={cls}><a.icon size={14} /></a>
            ) : (
              <button key={i} onClick={a.onClick} title={a.title} className={cls}><a.icon size={14} /></button>
            );
          })}
        </div>
      )}
    </div>
  );
}
