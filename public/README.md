# `public/` — Static Assets

Files served verbatim at the site root by Next.js. Anything here is publicly accessible and
addressed by absolute path (e.g. `/favicon.ico`, `/sw.js`).

## Responsibilities

- Host static, unprocessed assets: icons, favicon, manifest, and the service worker.
- Provide files that must keep stable, root-relative URLs.

## Developer notes & best practices

- Only place genuinely public, static files here — never secrets or environment config.
- Referenced by absolute path from the app root; these files are not processed by the
  bundler.
- The service worker (`/sw.js`, if present) is served with `no-cache` headers configured in
  `next.config.js`.

## Future extension points

- Progressive-web-app assets (icons set, manifest refinements) live here as the PWA surface
  grows.
