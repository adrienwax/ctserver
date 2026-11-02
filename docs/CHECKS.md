# Finding the relevant checks

[← Developer guide](DEVELOPMENT.md)

Start with `npm test` for the public offline subset. `scripts/test-public.mjs` is the authoritative list; a file being present does not mean it runs in that subset.

| Changed area | Relevant check families under `scripts/` |
| --- | --- |
| Key/dial assignment and page scope | `check-manual-assignment*`, `check-held-context*`, `check-editor-*` |
| Saved state, Undo and configuration upgrades | `check-file-history*`, `check-cross-profile-history*`, `check-config-upgrade*` |
| Home and profile selection | `check-home-*`, `check-profile-*` |
| Feedback, gauges, icons and contrast | `check-control-*`, `check-dial-*`, `check-icons*`, `check-contrast.mjs` |
| Device ownership and shutdown | `check-deck-*`, `check-electron-lifecycle.mjs` |
| App control contracts | `check-moshpit-*`, `check-bridge-*`, `check-workspace-*` |

Read a check before running it. Browser, native and integrated checks may need explicit fixture paths or private test processes; do not aim them at someone’s working configuration. Some retained specialist checks describe interfaces beyond the generic public defaults. Missing private test fixtures are not a reason to copy owner data into the repository.

Use `npm run test:contrast` for static token contrast. For a real device/app issue, a static pass cannot substitute for observing the affected workflow.
