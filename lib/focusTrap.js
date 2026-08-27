// lib/focusTrap.js
//
// ISSUE 4 — focus escaping modals.
//
// The app has 38 overlays across 9 files, nearly all hand-rolled as
// `<div className="fixed inset-0 z-[…]">`. Only ConfirmDialog had ANY a11y
// wiring, and even that had no Tab trap — pressing Tab inside it walked focus
// out into the sidebar and the page behind.
//
// Editing 38 call sites would mean 38 chances to introduce a regression in code
// that is otherwise working. Instead this installs ONE document-level trap that
// finds the topmost open overlay and keeps focus inside it. Every existing modal
// is covered — including any that were missed in the audit — and no modal's own
// markup has to change.
//
// What it does:
//   • Tab / Shift+Tab wrap within the topmost overlay.
//   • Focus is moved into the overlay when it opens (first field, else the panel).
//   • Focus is restored to the element that opened it when it closes.
//   • role="dialog" + aria-modal="true" are stamped on, for screen readers.
//
// What it deliberately does NOT do:
//   • It does not lock body scroll. Modal.js already owns a reference-counted,
//     iOS-safe scroll lock; a second, competing lock is exactly how you strand the
//     body at position:fixed forever. Overlays that don't use Modal.js still don't
//     lock scroll — that is a separate, known gap, not something to paper over here.
//   • It does not handle Esc. Most overlays already bind Esc themselves, and a
//     global Esc-to-close would have to guess which close handler to call.

const OVERLAY_SELECTOR = [
  '[data-modal]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '.fixed.inset-0',
].join(',');

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const zOf = (el) => {
  const z = parseInt(window.getComputedStyle(el).zIndex, 10);
  return Number.isNaN(z) ? 0 : z;
};

// Does this environment actually lay elements out? A real browser always gives the
// root element a client rect; jsdom (no layout engine) gives nothing. Without this
// gate the geometric test below reports EVERY element as invisible.
const hasLayout = () => {
  try { return document.documentElement.getClientRects().length > 0; } catch { return false; }
};

const isVisible = (el) => {
  if (!el || !el.isConnected) return false;
  const s = window.getComputedStyle(el);
  if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false;
  if (hasLayout()
      && el.getClientRects().length === 0
      && el.offsetWidth === 0 && el.offsetHeight === 0) return false;
  return true;
};

/** The overlay a user would consider "on top": highest z-index, then latest in the DOM. */
export function topmostOverlay(doc = document) {
  const all = [...doc.querySelectorAll(OVERLAY_SELECTOR)].filter(isVisible);
  if (!all.length) return null;
  // Drop overlays that merely CONTAIN another overlay (a backdrop wrapping a dialog);
  // we want the innermost one that actually holds the controls.
  let best = null;
  let bestZ = -Infinity;
  all.forEach((el) => {
    const z = zOf(el);
    if (z > bestZ || (z === bestZ && best && best.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      best = el;
      bestZ = z;
    }
  });
  return best;
}

export function focusablesIn(root) {
  if (!root) return [];
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => isVisible(el) && el.tabIndex !== -1);
}

/**
 * Install the global trap. Returns an uninstall function.
 * Safe to call more than once — subsequent calls are no-ops.
 */
let installed = false;
export function installGlobalFocusTrap() {
  if (typeof document === 'undefined' || installed) return () => {};
  installed = true;

  // The element focus should return to when the current overlay closes.
  let returnTo = null;
  let currentOverlay = null;

  const onKeyDown = (e) => {
    if (e.key !== 'Tab') return;
    const overlay = topmostOverlay();
    if (!overlay) return;
    // A SearchSelect panel is portalled to <body> and is NOT inside the overlay, but
    // it is logically part of it. Tabbing while it is open should not be hijacked.
    if (e.target && e.target.closest && e.target.closest('[data-searchselect-panel]')) return;

    const items = focusablesIn(overlay);
    if (!items.length) {
      // Nothing focusable: keep focus pinned to the overlay rather than letting it
      // escape to the page behind.
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const inside = overlay.contains(active);

    if (!inside) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }
    if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    }
    // Otherwise let the browser move focus naturally — it stays inside by construction.
  };

  // Detect overlays opening/closing so we can set initial focus and restore it after.
  const sync = () => {
    const overlay = topmostOverlay();
    if (overlay === currentOverlay) return;

    if (overlay && !currentOverlay) {
      // An overlay just opened: remember where focus was, then move it inside.
      returnTo = document.activeElement;
    }

    if (overlay) {
      if (!overlay.getAttribute('role')) overlay.setAttribute('role', 'dialog');
      if (!overlay.hasAttribute('aria-modal')) overlay.setAttribute('aria-modal', 'true');
      // Only steal focus if it is not already inside — respect an existing autoFocus.
      if (!overlay.contains(document.activeElement)) {
        const items = focusablesIn(overlay);
        const target = items.find((el) => el.matches('input,select,textarea')) || items[0] || overlay;
        if (target === overlay && !overlay.hasAttribute('tabindex')) overlay.setAttribute('tabindex', '-1');
        try { target.focus({ preventScroll: true }); } catch { /* jsdom */ }
      }
    } else if (currentOverlay && returnTo && returnTo.isConnected) {
      // Every overlay closed: give focus back to whatever opened it.
      try { returnTo.focus({ preventScroll: true }); } catch { /* jsdom */ }
      returnTo = null;
    }

    currentOverlay = overlay;
  };

  document.addEventListener('keydown', onKeyDown, true);
  const mo = new MutationObserver(sync);
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  sync();

  return () => {
    document.removeEventListener('keydown', onKeyDown, true);
    mo.disconnect();
    installed = false;
  };
}
