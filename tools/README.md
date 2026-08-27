# `tools/` — Static Analysis & Developer Scripts

Repository-local tooling run alongside the test suite to catch classes of defects that unit
tests do not. These are plain Node scripts with no external dependencies.

## Contents

| Script | Purpose |
|--------|---------|
| `scan-undef.cjs` | Scans source for undefined-identifier usage (e.g. a referenced import that was never imported). A known, documented set of false positives is expected; anything beyond that count is a real issue. |
| `scan-tdz.cjs` | Detects temporal-dead-zone hazards — a `const` referenced (e.g. in a hook dependency array) before its declaration in the same scope. Expected clean (0 findings). |
| `leak.cjs` | Flags `useEffect` hooks that create a subscription/timer/listener (`onSnapshot`, `setInterval`, `setTimeout`, `addEventListener`, `createObjectURL`, `new Worker`, `requestAnimationFrame`) but return no cleanup function. Takes file paths as arguments. |

## Usage

```bash
node tools/scan-undef.cjs .            # expect the known false-positive count
node tools/scan-tdz.cjs .              # expect 0 findings
node tools/leak.cjs components/*.js    # expect 0 findings — review any new one, see Developer notes
```

Run both after any change to catch wiring regressions that a green build can still hide
(Next.js may compile code that has a latent TDZ or an unreferenced identifier).

## Developer notes

- Treat a rise above the documented false-positive count in `scan-undef` as a real defect
  to fix before merging.
- A non-zero `scan-tdz` result means a declaration must be moved before its first use —
  common when adding a `useMemo`/effect whose dep array references a later `const`.
- `leak.cjs` findings are not all bugs — a mount-only (`[]`-dep) effect with a short one-shot
  `setTimeout` is often fine to leave as-is; a per-render or `requestAnimationFrame`-based
  effect that outlives a fast unmount/re-run is worth a closer look. Triage each finding
  against what the effect actually does before "fixing" it.

## Future extension points

- Additional lightweight scanners (unused-export detection, import-cycle checks) can be
  added here and wired into the same pre-merge routine.
