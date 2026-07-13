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

        {/* Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Montserrat:wght@400;500;600&display=swap"
          rel="stylesheet"
        />

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
