// pages/_document.js
import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en-IN" style={{ background: '#0a0a0a' }}>
      <Head>
        {/* PWA */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0a0a0a" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Maruti Care" />

        {/* Fonts: Cinzel + Montserrat are self-hosted via next/font in _app.js (PERF-001) — no
            third-party stylesheet, so nothing here blocks first paint. */}

        {/* SEO */}
        <meta name="description" content="Inventory & Workshop OS for Sri Baba Balaji Maruti Care" />
      </Head>
      <body style={{ background: '#0a0a0a' }}>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
