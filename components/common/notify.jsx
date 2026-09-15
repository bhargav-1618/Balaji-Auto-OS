// components/common/notify.jsx
// Semantic toast helpers — the ONE place that maps a notification's MEANING to an icon
// from the app's existing icon library (lucide-react), and the ONE place every module
// should reach for icon-bearing toasts instead of hand-picking an icon (or an emoji —
// several call sites used to reach for 🔒 🔍 🧾 📝 🧪 🔌 ℹ️ before this existed) per
// call site. Built on `lib/toast`, so every notification created through here — and
// every plain `toast.success()` / `toast.error()` call elsewhere in the app, since they
// import the same shared `toast` — automatically de-duplicates: repeating the same
// action while its toast is still showing refreshes that one toast instead of stacking
// a duplicate on top of it.
import React from 'react';
import toast, { TOAST_DURATION } from '../../lib/toast';
import { Lock, Info, CheckCircle2, XCircle, TriangleAlert, Trash2, Save, Upload, Download } from 'lucide-react';

const ICON_SIZE = 17;

// COLOR SYSTEM REVIEW: `success`/`error` below pass a REPLACEMENT `icon` to override
// pages/_app.js's global <Toaster> icon (react-hot-toast replaces, never merges, a
// per-call icon over the global one) — but without also repeating the global icon's
// color, the replacement rendered in the toast's default neutral text color instead of
// green/red. Net effect: `toast.success('X')` showed a GREEN check, but
// `notify.success('X')` — the exact same semantic outcome — showed a neutral gray one,
// depending only on which helper a module happened to call. Fixed by matching the exact
// colors pages/_app.js's global success/error icons already use, so the icon color never
// depends on which of the two equivalent call styles was used.
const SUCCESS_COLOR = '#34d399';
const ERROR_COLOR = '#ef4444';

export const notify = {
  // Blocked by a permission/role check — demo-mode guard, staff restriction, read-only
  // account, etc. Warning-tier duration: the user needs a moment to understand WHY
  // their action didn't go through, not just that it didn't. Amber, matching `warning`
  // below — both are the same WARNING severity tier and should read as one.
  permissionDenied: (message, opts) => toast(message, { icon: <Lock size={ICON_SIZE} className="text-amber-400" />, duration: TOAST_DURATION.WARNING, ...opts }),
  // General informational notice — search hints, draft-restored, feature-not-connected,
  // demo-only limitation.
  info: (message, opts) => toast(message, { icon: <Info size={ICON_SIZE} className="text-sky-400" />, duration: TOAST_DURATION.INFO, ...opts }),
  // A caution the user should notice but that isn't an outright error — must read
  // distinctly longer than a success toast, or it functionally IS just a success toast
  // with a different icon (Issue 8: warning severity must be behaviourally distinct).
  warning: (message, opts) => toast(message, { icon: <TriangleAlert size={ICON_SIZE} className="text-amber-400" />, duration: TOAST_DURATION.WARNING, ...opts }),
  // Explicit success/error with the app's own icon set, for call sites that want a
  // specific icon rather than the global <Toaster> default. Most success/error toasts
  // don't need this — `toast.success()` / `toast.error()` already render Check /
  // CircleX via the global config in pages/_app.js — but these MUST stay the same color
  // as that global default, not just the same icon shape.
  success: (message, opts) => toast.success(message, { icon: <CheckCircle2 size={ICON_SIZE} color={SUCCESS_COLOR} />, ...opts }),
  error: (message, opts) => toast.error(message, { icon: <XCircle size={ICON_SIZE} color={ERROR_COLOR} />, ...opts }),
  // Action-specific successes that deserve a more specific icon than a generic checkmark.
  // Red here is deliberate, not a success/danger mix-up: it color-codes the ICON to the
  // nature of the action (destructive, same red as every Delete button in this app),
  // while the toast itself still reads and behaves as a success (green checkmark family
  // reserved for the plain confirmation case above).
  deleted: (message, opts) => toast.success(message, { icon: <Trash2 size={ICON_SIZE} className="text-red-400" />, ...opts }),
  saved: (message, opts) => toast.success(message, { icon: <Save size={ICON_SIZE} color={SUCCESS_COLOR} />, ...opts }),
  imported: (message, opts) => toast.success(message, { icon: <Upload size={ICON_SIZE} color={SUCCESS_COLOR} />, ...opts }),
  exported: (message, opts) => toast.success(message, { icon: <Download size={ICON_SIZE} color={SUCCESS_COLOR} />, ...opts }),
};

export default notify;
