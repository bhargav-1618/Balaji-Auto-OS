# `context/` — React Context Providers

Global, cross-cutting state exposed through React Context. Context is used sparingly — only
for concerns that genuinely span the whole app — to avoid coupling unrelated modules.

## Contents

| File | Purpose |
|------|---------|
| `AuthContext.js` | Authentication state provider. Wraps Firebase Auth, exposes `user`, `loading`, `role`/`perms`, `demoMode`/`demoAdmin`/`exitDemo`, and `authTimedOut`/`retryAuthInit`, and drives the app's protected-route behaviour. |

## Responsibilities

- Subscribe to Firebase Auth (`onAuthStateChanged`) and expose the current user + loading
  state to the tree.
- Expose `demoMode`/`demoAdmin`/`exitDemo` so the app can enter (and leave) an isolated
  public sandbox without real credentials.
- Time out auth initialization (`authTimedOut`) and expose `retryAuthInit()` so a stalled
  Firebase connection doesn't leave the boot splash spinning forever.
- Provide a single source of truth for “is someone signed in, and with what role?” consumed
  by `pages/index.js` (route guard) and the shell (permission/demo gating).

## Data flow

```
Firebase Auth ──► AuthContext (onAuthStateChanged) ──► useAuth() ──► pages/index.js, shell
```

## Developer notes

- Keep context minimal; per-module state belongs in the module, not here.
- Anything read at the top of every render (auth, theme) is a fair candidate for context;
  transient view state is not.

## Future extension points

- A theme or feature-flag provider could live here following the same pattern.
