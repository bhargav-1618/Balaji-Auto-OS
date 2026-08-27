// lib/toast.js
// Drop-in replacement for react-hot-toast's `toast` — the ONE place every module
// reaches for a toast, so placement/duration/stacking/dedup behaviour is defined once
// and every caller inherits it automatically instead of re-implementing it.
//
// THE DEDUP BUG THIS FIXES: react-hot-toast creates a brand-new toast entry on every
// call by default (each call gets a fresh auto-generated id). Click an action that shows
// "This action has been disabled by the administrator." five times in a row and you get
// five identical toasts stacked on screen — react-hot-toast's own docs recommend the fix
// used here: pass a STABLE `id` derived from the message. When a toast with that id is
// already showing, react-hot-toast UPDATES it in place (verified against its source:
// `case 2` — ADD_TOAST — checks whether a toast with that id already exists and, if so,
// dispatches an UPDATE instead of prepending a new one) rather than creating a second
// entry. Because the updated toast's `createdAt` is refreshed to "now", this also resets
// its auto-dismiss timer — so a repeated action both prevents stacking AND keeps the
// toast visible for a fresh duration, which is exactly the behaviour every other toast
// in a well-behaved app has.
//
// Every module should import `toast` from here instead of directly from
// 'react-hot-toast' — that's the one-line change that gives an existing
// `toast.success('X')` / `toast.error('X')` / `toast('X')` call site this behaviour for
// free, with no change to the call site itself.
import hotToast from 'react-hot-toast';

// Universal Toast Architecture review — named duration tiers, not a magic number per
// call site. Before this, call sites across the app independently invented 3000, 4000,
// 5000, 6000, 7000 and 8000ms with no documented reasoning tying the number to the
// message's actual importance. pages/_app.js's <Toaster> reads SUCCESS/ERROR from here
// for its global defaults; notify.jsx applies INFO/WARNING automatically so a call site
// gets the right duration for free just by picking the right severity helper. A caller
// can still always pass its own `{ duration }` to override for a specific message.
export const TOAST_DURATION = {
  SUCCESS: 3000, // "Part saved." — glanced at, not read word-for-word; gone quickly.
  INFO: 4000, // A little more to read and understand before it's gone.
  WARNING: 5000, // Needs to be noticed AND acted on — longer than a success.
  ERROR: 6000, // Must remain long enough to actually read the failure.
  ERROR_CRITICAL: 8000, // A blocked/failed operation with real consequences (a bulk cap,
  // a payment mismatch, a permission failure) — the longest tier short of "manual
  // dismiss only". Pass { duration: TOAST_DURATION.ERROR_CRITICAL } explicitly for these.
};

// Short, stable hash of the message text — used as the toast id so repeat calls with
// the SAME message collapse onto the SAME toast instead of stacking. Different messages
// naturally get different ids and so still appear independently and simultaneously.
function idFor(message) {
  const text = typeof message === 'string' ? message : JSON.stringify(message ?? '');
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0; // eslint-disable-line no-bitwise
  }
  return `t_${hash}`;
}

// A caller-supplied `id` always wins (e.g. react-hot-toast's own `toast.promise` pattern,
// which threads one id through loading → success/error) — dedup-by-message only applies
// when the call site didn't already ask for a specific toast identity.
const withDedupeId = (message, opts) => ({ id: idFor(message), ...opts });

// --- Stacking policy (Issue 10/11: a bounded, priority-aware stack) ---------------
// react-hot-toast itself has no concept of "too many toasts" beyond an internal
// hard cap of 20. That's a safety ceiling, not a UX policy. This app's realistic
// notification volume is one operator triggering one operation at a time, so the
// policy only needs to matter in the rare case several legitimate toasts land close
// together (e.g. a live-sync error alongside a save confirmation): cap how many are
// visible at once, and when over the cap, evict the OLDEST toast at or below the
// incoming toast's priority — never evict something more important than what's
// arriving, so a routine success can never push a still-relevant error off screen.
const MAX_VISIBLE_TOASTS = 4;
const PRIORITY = { error: 3, loading: 2, blank: 2, custom: 2, success: 1 };
const STALE_TRACKING_MS = 15000; // well past every duration tier above — safe to forget
const tracked = new Map(); // id -> { priority, at }

function trackAndEnforceLimit(id, type) {
  const now = Date.now();
  // Bound the tracking map itself — it only ever grows on add, so prune anything old
  // enough that react-hot-toast has certainly already dismissed it on its own.
  tracked.forEach((entry, trackedId) => { if (now - entry.at > STALE_TRACKING_MS) tracked.delete(trackedId); });
  tracked.set(id, { priority: PRIORITY[type] ?? 1, at: now });
  if (tracked.size <= MAX_VISIBLE_TOASTS) return;
  const incomingPriority = tracked.get(id).priority;
  const evictable = [...tracked.entries()]
    .filter(([entryId, entry]) => entryId !== id && entry.priority <= incomingPriority)
    .sort((a, b) => a[1].priority - b[1].priority || a[1].at - b[1].at);
  if (evictable.length) {
    const [evictId] = evictable[0];
    hotToast.dismiss(evictId);
    tracked.delete(evictId);
  }
}

function toast(message, opts) {
  const merged = withDedupeId(message, opts);
  trackAndEnforceLimit(merged.id, 'blank');
  return hotToast(message, merged);
}
toast.success = (message, opts) => {
  const merged = withDedupeId(message, opts);
  trackAndEnforceLimit(merged.id, 'success');
  return hotToast.success(message, merged);
};
toast.error = (message, opts) => {
  const merged = withDedupeId(message, opts);
  trackAndEnforceLimit(merged.id, 'error');
  return hotToast.error(message, merged);
};
// Loading toasts represent an operation IN PROGRESS — they must never auto-dismiss on
// a timer (Issue 3/15: "Generating 120 PDFs..." disappearing after 3s while the work is
// still running is worse than no feedback at all, since a later success/error toast
// then appears to come from nowhere). Infinity here is the default; a caller that
// deliberately wants a short-lived loading indicator (e.g. a sub-second "Reconnecting…"
// probe) can still pass its own `duration` to override it.
toast.loading = (message, opts) => {
  const merged = withDedupeId(message, { duration: Infinity, ...opts });
  trackAndEnforceLimit(merged.id, 'loading');
  return hotToast.loading(message, merged);
};
// Pass-throughs — these don't create/identify a toast by message text, so no dedup logic
// applies; forward to the real implementation unchanged.
toast.custom = hotToast.custom;
toast.promise = hotToast.promise;
toast.dismiss = hotToast.dismiss;
toast.remove = hotToast.remove;

export default toast;
