// pages/_app.js
import { useEffect } from 'react';
import Head from 'next/head';
import { Toaster } from 'react-hot-toast';
import { CheckCircle2, XCircle } from 'lucide-react';
import { AuthProvider, useAuth } from '../context/AuthContext';
import ErrorBoundary from '../components/ErrorBoundary';
import { installGlobalFocusTrap } from '../lib/focusTrap';
import { LanguageProvider } from '../lib/i18n';
import { TOAST_DURATION } from '../lib/toast';
import '../styles/globals.css';

// Localization needs demoMode (to read/write the same isolated demo settings blob
// every other Business Profile field already uses) — that only exists inside
// AuthProvider, so this thin bridge sits between the two instead of LanguageProvider
// importing AuthContext itself (keeps lib/i18n.js consumer-agnostic; see its header).
function LocalizedApp({ children }) {
  const { demoMode } = useAuth();
  return <LanguageProvider demoMode={demoMode}>{children}</LanguageProvider>;
}

export default function App({ Component, pageProps }) {
  // ISSUE 4: one global focus trap covers all 38 overlays. See lib/focusTrap.js.
  useEffect(() => installGlobalFocusTrap(), []);

  // Register Service Worker
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const onLoad = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .catch((err) => console.error('SW registration failed:', err));
    };
    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);

  return (
    <ErrorBoundary>
      <AuthProvider>
      <LocalizedApp>
      <Head>
        {/* Without this, phones render at ~980px desktop width and zoom out,
            and the md: breakpoints fire the desktop layout on mobile. */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
      </Head>
      <Component {...pageProps} />
      {/*
        Universal Notification Architecture — the ONE notification surface for the
        entire application (Issue: "do not maintain separate InventoryToast/
        BillingToast/JobCardToast implementations"). Every module reaches this same
        layer via lib/toast.js / components/common/notify.jsx — nothing renders its
        own toast/banner component.

        Layering: mounted as a direct child of the app root (a sibling of
        <Component>, not nested inside any page/module's own DOM), and react-hot-
        toast's own container is `position: fixed` with `zIndex: 9999`. The highest
        z-index used anywhere else in the app (modals, drawers, dropdowns, the PDF
        preview, ConfirmDialog) tops out at 300 — a toast is therefore always above
        every other layer, and because it's fixed to the viewport at the react tree
        root (not inside a scrollable table/modal/drawer), it can never be trapped
        inside a scrolling container or clipped by one's `overflow`.
      */}
      <Toaster
        position="top-right"
        gutter={10}
        toastOptions={{
          // Issue 3: named duration tiers (lib/toast.js), not a magic number per
          // call site. Success reads at a glance and clears quickly; loading toasts
          // (Issue 15) default to Infinity in lib/toast.js itself, so a long-running
          // "Generating…" indicator can never time out before the work finishes.
          duration: TOAST_DURATION.SUCCESS,
          className: 'app-toast',
          style: {
            background: '#1c1c1c',
            color: '#e5e5e5',
            border: '1px solid rgba(212,175,55,0.25)',
            borderRadius: '12px',
            fontFamily: 'Montserrat, sans-serif',
            fontSize: '13px',
            fontWeight: 500,
            // Issue 17: keep long error text inside the toast — wrap, cap width,
            // never overflow the viewport on desktop or mobile.
            maxWidth: 'min(420px, calc(100vw - 32px))',
            width: 'auto',
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
            whiteSpace: 'pre-wrap',
            lineHeight: '1.45',
            boxSizing: 'border-box',
            padding: '13px 16px',
            boxShadow: '0 10px 32px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.03) inset',
          },
          // Explicit lucide icons (rather than react-hot-toast's built-in check/cross
          // glyphs) so every notification in the app — success, error, and the semantic
          // ones in components/common/notify.jsx — draws from the same icon library.
          success: {
            icon: <CheckCircle2 size={18} color="#34d399" />,
          },
          error: {
            duration: TOAST_DURATION.ERROR,
            icon: <XCircle size={18} color="#ef4444" />,
            // Issue 16 (accessibility): an error is the one severity where a screen
            // reader should interrupt whatever it's currently announcing rather than
            // queue politely behind it — react-hot-toast's default for every toast
            // type is role="status"/aria-live="polite" (confirmed against its own
            // source), which is correct for success/info/loading but too easy to
            // miss for a failure. role="alert"/aria-live="assertive" here matches
            // the semantics screen readers already expect from an error.
            ariaProps: { role: 'alert', 'aria-live': 'assertive' },
          },
        }}
      />
      </LocalizedApp>
    </AuthProvider>
    </ErrorBoundary>
  );
}
