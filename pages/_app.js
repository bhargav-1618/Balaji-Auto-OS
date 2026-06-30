// pages/_app.js
import { useEffect } from 'react';
import Head from 'next/head';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from '../context/AuthContext';
import ErrorBoundary from '../components/ErrorBoundary';
import '../styles/globals.css';

export default function App({ Component, pageProps }) {
  // Register Service Worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .catch((err) => console.error('SW registration failed:', err));
      });
    }
  }, []);

  return (
    <ErrorBoundary>
      <AuthProvider>
      <Head>
        {/* Without this, phones render at ~980px desktop width and zoom out,
            and the md: breakpoints fire the desktop layout on mobile. */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
      </Head>
      <Component {...pageProps} />
      <Toaster
        position="bottom-center"
        toastOptions={{
          duration: 3000,
          style: {
            background: '#222222',
            color: '#e5e5e5',
            border: '1px solid rgba(212,175,55,0.3)',
            borderRadius: '10px',
            fontFamily: 'Montserrat, sans-serif',
            fontSize: '13px',
            // Issue 3: keep long error text inside the toast — wrap, cap width,
            // never overflow the viewport on desktop or mobile.
            maxWidth: 'min(460px, calc(100vw - 32px))',
            width: 'auto',
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
            whiteSpace: 'pre-wrap',
            lineHeight: '1.4',
            boxSizing: 'border-box',
          },
          success: {
            iconTheme: { primary: '#d4af37', secondary: '#111' },
          },
          error: {
            duration: 6000,
            iconTheme: { primary: '#ef4444', secondary: '#fff' },
          },
        }}
      />
    </AuthProvider>
    </ErrorBoundary>
  );
}
