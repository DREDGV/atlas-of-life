# Atlas of Life — baseline for revival

Development direction: [ROADMAP_REVIVAL.md](./ROADMAP_REVIVAL.md).

This document records the safe starting point before new product work. It is intentionally small: the goal is to make every later decision reversible and testable.

## Snapshot

- Working branch: `revival-preparation`.
- Baseline code: `v0.2.7.5` / commit `4c6ecfe` (9 September 2025).
- The current browser build is a static ES-module application: `index.html` + `js/` + `styles.css`.
- The application is launched locally with `python -m http.server 8000` and opened at `http://127.0.0.1:8000`.
- Runtime data belongs to the browser (`localStorage`). Before changing state or storage code, export it with the UI's **Export** button.

## Baseline checks

Run the read-only check before and after a focused change:

```powershell
powershell -ExecutionPolicy Bypass -File tools/verify-baseline.ps1
```

It verifies the entry-point assets, JavaScript syntax and state-normalization regression test without installing dependencies or changing application data.

## Observed behaviour

- The supplied map opens and renders correctly with the user's data.
- The filters list currently exposes `#undefined`. Treat this as a data/UI normalization bug; do not hide it blindly, because the underlying tasks must first be inspected and normalized safely.
- The local baseline is syntactically valid, but has no automated browser-level regression suite.

## Upgrade boundary

`origin/main` is 260 commits ahead of this baseline. It contains work up to early October 2025, including a newer Inbox, checklist UI, map modularization and hierarchy/history work. It must be evaluated as a candidate, not merged into this branch automatically: the later hierarchy subsystem accumulated several repair commits and has no final tagged stable release after `v0.8.3.0`.

## Initial quality gates

1. Preserve real data: export/import must round-trip without losses.
2. Keep the map usable: pan, zoom, inspect, create, edit and move a task must work on every change.
3. Keep the browser console free of errors in the primary flow.
4. Make one coherent feature change per branch and verify it with the baseline script plus a short manual browser pass.

## First implementation candidates

1. Repair and normalize invalid task tags (`undefined`) with a migration-safe approach.
2. Add a real smoke test for the main user flow and wire it into a local command.
3. Compare the stable `v0.8.3.0` tag with current `origin/main`, then selectively carry forward mature features.
