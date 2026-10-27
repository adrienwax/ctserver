# CTserver

A configurable Loupedeck CT controller for Moshpit and everyday app controls.

**Source release. Windows binary downloads are not included.**

## Use

- **Home**: browse apps, profiles and pages; confirm with OPEN, USE or ENTER.
- **LIVE**: operate the selected profile.
- **MAP**: select a control, assign an action, label or colour. Changes autosave;
  wait for Saved. Undo and Redo are available.
- **DIAGNOSE**: inspect connection status.
- **Guides**: bundled local instructions, with no private library dependency.

Generic profiles cover Home, Moshpit, Windows, Spotify and Resolve. Start the
target app normally. A verified Moshpit/TD launch path can optionally be set in
your own `apps.json`; see Guides. TouchDesigner requires a compatible rig and
matching profile; no private TD project is supplied.

In the desktop app, closing the window hides it. Use the tray menu's Quit CTserver to release CT.

## Source setup

Windows x64 and Node 24 are the preparation target. Use `npm ci`, then
`npm run setup:bridge` for the bridge's separate locked dependencies. Review
third-party install scripts before running them on another machine. Native
canvas/serialport builds must match the packaged Electron runtime.

After setup, `node node_modules/electron/cli.js .` opens the desktop app.
`npm start` or `waxyct.bat` runs the router with a browser panel instead; that
mode has no desktop tray. It can take control of a connected CT, so quit other
CT owners before starting it. No companion private project is required.

Optional browser scripts need a local Playwright installation, or an explicit
`CT_PLAYWRIGHT_MODULE` file URL. They are not included in the offline suite.

`node --test scripts/check-editor-release-routes.mjs scripts/check-home-boundary.mjs`
runs the generic-default and Home-boundary checks. Set TEMP/TMP to an isolated
test folder. `npm test` runs the public offline subset. Native/device and optional browser
checks remain separate; the old private studio rig suite is not included.

Packaging uses `npm run package`, with optional `KRAB_SCRATCH_ROOT` to select
build storage. Windows EXE packaging and clean-machine/device acceptance remain separate
gates for future downloads; successful source checks are not device acceptance.

## Verified source checks

Fresh local `npm ci --ignore-scripts` installs passed for both the app and
`integrations/ct-td-control` on Windows with Node 24. The public offline suite
passed all 20 checks with those dependencies. These checks neither opened a
device nor ran native-addon installation scripts. Electron/native installation and a first-run
test on another Windows machine are still required before offering binaries.

The locked `strict-event-emitter` dependency declares MIT but its npm package
and exact `v0.5.1` upstream tag omit the full licence text. This source export
does not vendor its implementation. The notice gap remains open for any
distribution that bundles the dependency; no replacement notice was invented.

## Licence

Original project code: MIT, copyright 2026 ak wax. Preserve third-party notices
under `third-party/`. This is an independent project, not an official Loupedeck
application. Third-party app names identify compatible tools, not endorsements.

## Bugs and security

Report reproducible bugs in [GitHub Issues](https://github.com/adrienwax/ctserver/issues). Include the
version or commit, steps, expected result and actual result. Remove personal
paths, footage and credentials from attachments.

For security vulnerabilities, use [private reporting](https://github.com/adrienwax/ctserver/security/advisories/new),
not a public issue. See [SECURITY.md](SECURITY.md).

Optional Python-based checks use `python` on PATH, or `CT_TEST_PYTHON` for an explicit executable.
