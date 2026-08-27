# `pages/` — Next.js Routes

Next.js Pages Router entry points. The application is a **single-page tabbed shell**, so
this folder is intentionally small: it handles authentication routing and mounts the shell.
All in-app navigation happens inside the shell via the tab model and deep-link convention,
not through additional page routes.

## Routes

| File | Route | Purpose |
|------|-------|---------|
| `index.js` | `/` | Authenticated entry point. Guards access (redirects unauthenticated users to `/login`), starts the idle-timeout watcher, and mounts `InventoryDashboard`. |
| `login.js` | `/login` | Email/password sign-in and the boot/splash experience. |
| `verify.js` | `/verify` | Post-auth verification step. |
| `404.js` | `/404` | Custom branded not-found page. |
| `_app.js` | — | App wrapper: global providers (Auth context), toaster, global styles, viewport. |
| `_document.js` | — | Custom HTML document (fonts, `lang`, base markup). |

## Authentication flow

```
/login  ── sign in ──►  onAuthStateChanged fires  ──►  /  (index.js)
   ▲                                                     │
   └──────── redirect if !user && !demoMode ◄────────────┘
                    │
              idle timeout (session.js) ── sign out + clear caches ──► /login?expired=1
```

- `index.js` reads `user`, `loading`, `demoMode` from `AuthContext` and redirects
  unauthenticated visitors to `/login`.
- An idle-timeout watcher signs the user out after inactivity and clears cached business
  data from `localStorage` so the next person on a shared terminal cannot read it.
- Demo mode bypasses auth into an isolated sandbox dataset.

## Developer notes

- Keep this folder thin. New user-facing screens should be **tabs inside the shell**, not
  new routes, unless they are genuinely separate destinations (auth, verification).
- The viewport is defined once in `_app.js`; do not redefine `maximum-scale` (it would
  break pinch-zoom / WCAG 1.4.4).

## Future extension points

- If the shell is later decomposed for bundle-size reasons, per-tab routes could be
  introduced here with lazy loading, while preserving the deep-link contract.
