# `constants/` — Application Constants

Centralised, immutable configuration values shared across the app. Keeping these in one
place prevents magic strings/numbers from drifting between modules.

## Contents

| File | Purpose |
|------|---------|
| `index.js` | Core constants — tab keys (`TAB_KEYS`), collection names, limits, and other app-wide values. |
| `ui.js` | UI-specific constants (spacing, sizing, and presentation tokens). |

## Responsibilities

- Define the canonical list of navigation tabs (`TAB_KEYS`) used by the shell's router and
  the deep-link reader.
- Name Firestore collections in one place so repositories and rules stay aligned.
- Hold numeric limits (pagination sizes, thresholds) referenced across modules.

## Developer notes & best practices

- Import from here rather than re-declaring literals in components.
- `TAB_KEYS` is the source of truth for valid tabs; the deep-link reader validates against
  it, so new tabs must be registered here.
- Keep values immutable (`Object.freeze` where appropriate).

## Future extension points

- Environment-specific constants can be layered in without changing consumers.
