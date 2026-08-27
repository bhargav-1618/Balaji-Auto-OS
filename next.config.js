/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    // Baseline security headers for every route. A production ERP on a public URL should
    // set these regardless of host defaults. A Content-Security-Policy IS now set below,
    // tuned against the app's inline styles (styled-jsx) and Firebase/Google origins.
    // It must be re-validated in-browser if new third-party origins are introduced.
    //
    // NOTE: `next dev` injects React Fast Refresh, which uses eval(). So 'unsafe-eval' is
    // added to script-src in development ONLY. Production builds (`next build`/`next start`,
    // Vercel) do not use eval, so the deployed policy stays strict (no 'unsafe-eval').
    const isDev = process.env.NODE_ENV !== 'production';
    const scriptSrc = [
      "script-src 'self' 'unsafe-inline'",
      isDev ? "'unsafe-eval'" : '',
      'https://apis.google.com https://www.gstatic.com https://www.googleapis.com',
    ].filter(Boolean).join(' ');
    const securityHeaders = [
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
      { key: 'X-DNS-Prefetch-Control', value: 'on' },
      // Content-Security-Policy tuned for this app's actual origins:
      //  - Firebase Auth/Firestore (googleapis.com, firebaseio.com, gstatic.com)
      //  - Google Fonts (fonts.googleapis.com / fonts.gstatic.com)
      //  - styled-jsx + Tailwind inline styles → 'unsafe-inline' for style-src
      //  - base64 photos stored in Firestore → data: in img-src
      //  - 'unsafe-eval' is dev-only (see scriptSrc above); production omits it.
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          scriptSrc,
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com data:",
          "img-src 'self' data: blob: https:",
          "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.google.com wss://*.firebaseio.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
          "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; '),
      },
    ];
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
