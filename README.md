# CTserver

**Make a Loupedeck CT your own: app profiles, labelled controls and editable actions.**

CTserver is an independent desktop controller app. Browse profiles, see what each control does, and assign actions to touchscreen tiles, buttons and knobs. It includes generic controls for Moshpit, Windows, Spotify and DaVinci Resolve, with a Home page for finding profiles and pages.

**Free, open-source development release. Source is available now; public Windows installers are not available yet.** Local unsigned installer candidates are being checked for portability, dependency licences and signing. They have not passed a fresh-Windows acceptance test. The installer changes are not yet on this public branch.

[Moshpit](https://github.com/adrienwax/moshpit) · [Report a bug](https://github.com/adrienwax/ctserver/issues) · [Report a vulnerability privately](https://github.com/adrienwax/ctserver/security/advisories/new) · [MIT licence](LICENSE)

## Find your way around

| Area | Purpose |
| --- | --- |
| **Home** | Browse apps, profiles and pages; confirm a choice with OPEN, USE or ENTER. |
| **LIVE** | See and operate the selected profile. |
| **MAP** | Select a control, choose its action, then edit its label, icon or colour. |
| **DIAGNOSE** | Check controller ownership, connection and control-link status. |
| **Guides** | Open bundled instructions. No private library is required. |

**MAP edits autosave.** After changing a label, leave the field and wait for **Saved**. Use **Undo** or **Redo** to correct an edit. Activating a profile on CT and saving an edit are different actions; activation is not a Save button.

You can inspect/edit mappings without a controller. Physical control needs a **Loupedeck CT connected over USB**. Other Loupedeck models have not been validated. Quit another application that owns the CT normally before letting CTserver connect; two owners should not compete for it.

Start target applications normally. Generic profiles provide actions, not the target applications themselves. App focus, keyboard shortcuts and compatible control endpoints can affect what works. TouchDesigner requires a compatible rig and matching profile; no TD project is supplied. Optional verified application paths belong in your own `apps.json`; consult Guides before enabling launches.

## Run from source

The current target is **Windows x64 with Node.js 24**. Other platforms are not validated. You need Git and npm. CT bridge dependencies include native modules; if compatible prebuilt modules are unavailable, their build tools are needed.

```powershell
git clone https://github.com/adrienwax/ctserver.git
cd ctserver
npm ci
npm run setup:bridge
node node_modules/electron/cli.js .
```

The bridge has a separate lockfile, so both installation commands are required. Dependency installation can download Electron and run native build scripts; review those scripts first. Native modules must load under the exact Electron runtime, not merely under your system Node executable.

Alternatively, `npm start` or `waxyct.bat` starts the router with a browser panel. This mode has **no desktop tray** and can take control of a connected CT. Use one mode at a time.

## Saving, quitting and startup

- **Closing the desktop window hides it in the tray.** Use **Quit CTserver** in the tray menu to exit and release the controller.
- Source runs use the checkout's `config` folder by default. `WAXYCT_CONFIG` selects an alternative configuration directory. Back up the configuration before experimenting with your own mappings.
- The public packaged desktop code uses `%APPDATA%/waxyct/config`; its configuration updater preserves edited files. A source checkout and a packaged app therefore need not use the same profiles.
- Cloning or installing dependencies does **not** automatically enable Windows startup. Startup is an explicit setup choice. `--start-in-tray` starts the desktop app hidden when used by a startup shortcut. Do not point a persistent shortcut at a temporary build folder.

## Troubleshooting

| Symptom | First check |
| --- | --- |
| Device is blank or unavailable | Check USB, then DIAGNOSE. Quit the previous CT owner normally before connecting this app. |
| App is still running after closing its window | Look in the Windows tray; X hides the app, while Quit exits it. |
| Knobs/buttons do nothing in another app | Check the selected profile/page, target app focus, and its control-link status. |
| A native dependency fails to load | Keep the error and exact Node/Electron versions. Confirm the separate bridge installation completed. |
| An edited label is not retained | Leave the field, wait for Saved, and check which configuration directory this run uses. |

## Development checks

```powershell
npm test
node --test scripts/check-editor-release-routes.mjs scripts/check-home-boundary.mjs
```

Use an isolated TEMP/TMP folder for tests. Optional Python checks use `python` on PATH or `CT_TEST_PYTHON`. Browser checks need a local Playwright installation or `CT_PLAYWRIGHT_MODULE` file URL; they are separate from the offline suite.

The initial public source passed fresh local `npm ci --ignore-scripts` checks for the app and bridge, plus its 20-check offline suite on Windows/Node 24. Those checks did not install native addons, open the controller or establish clean-machine/device readiness.

Packaging uses `npm run package`; `KRAB_SCRATCH_ROOT` selects build storage. The public portable packaging path and the new local installer candidates are different stages. Public installers remain withheld until the remaining binary checks pass.

## Licences and compatibility

Original project code is **MIT**, copyright **2026 ak wax**. See [LICENSE](LICENSE), [third-party notices](THIRD-PARTY-NOTICES.txt), [asset notices](ASSET-NOTICES.txt) and the [third-party directory](third-party). Dependencies retain their own licences.

One bundled-dependency gate remains open: `strict-event-emitter` 0.5.1 declares MIT but its exact npm package and upstream tag omit the full licence notice. This source repository does not vendor its implementation, and no replacement notice has been invented. The gap must be resolved before distributing a package containing it.

CTserver is not an official Loupedeck product. Third-party names identify compatible tools, not endorsements or a promise that every app version and shortcut configuration has been tested.

## Help and contributions

Use [GitHub Issues](https://github.com/adrienwax/ctserver/issues) for bugs and proposals. Include the commit/version, Windows version, CT connection state, profile/page, steps and expected/actual results. Remove private app paths, credentials and unrelated profiles from attachments.

Discuss substantial changes before implementation; keep patches focused and include a regression check where practical. Do not commit personal profiles, caches, generated installers or credentials.

Report security vulnerabilities through [private reporting](https://github.com/adrienwax/ctserver/security/advisories/new), not public issues. See [SECURITY.md](SECURITY.md).
