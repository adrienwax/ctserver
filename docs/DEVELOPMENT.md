# CTserver: source and repository guide

[← User guide](../README.md) · [Release limitations](RELEASE-STATUS.md)

## Run from source

Current target: **Windows x64, Node.js 24, npm and Git**. Other platforms are not validated. Native canvas/serialport dependencies must be compatible with the Electron runtime, not just the system Node version.

```powershell
git clone https://github.com/adrienwax/ctserver.git
cd ctserver
npm ci
npm run setup:bridge
node node_modules/electron/cli.js .
```

The bridge has a separate lockfile: both dependency installation commands are needed. They can run third-party scripts and download Electron/native components. If compatible prebuilt native modules are unavailable, native build tools are required; keep the exact error rather than assume installation succeeded.

`npm ci --ignore-scripts` is useful for source review only. It does not establish a runnable Electron/native environment.

Alternatively, `npm start` or `waxyct.bat` starts the router with a browser panel. This mode has **no desktop tray** and can take control of a connected CT. Run one mode and one device owner at a time.

## Settings and startup

- Source runs use the checkout’s `config/` directory by default. `WAXYCT_CONFIG` selects an alternative directory; back up your configuration before experiments.
- The public packaged desktop code uses `%APPDATA%/waxyct/config`. Its updater preserves edited configuration. Candidate packages can use another private application identity; check the version you are running.
- Cloning or installing dependencies does **not** enable Windows startup. `--start-in-tray` starts the desktop app hidden when used by an explicitly configured startup shortcut. Do not point a permanent shortcut at a temporary build directory.
- `config.example.json` documents optional router overrides. It is not an extra profile you need to activate.
- Profiles and local endpoint/launch settings may contain private paths or tokens. Do not commit your personal configuration back into this repository.

## Checks

```powershell
npm test
npm run test:persistence
npm run test:contrast
node --test scripts/check-editor-release-routes.mjs scripts/check-home-boundary.mjs
```

Managed npm checks isolate scratch files. `KRAB_SCRATCH_ROOT` selects build storage. Give direct tests an isolated TEMP/TMP directory. Optional Python checks use `python` or `CT_TEST_PYTHON`; browser checks require Playwright or an explicit `CT_PLAYWRIGHT_MODULE` path.

Offline tests, browser checks, Electron/native-module checks and physical device acceptance are different layers. The public suite does not include private studio rigs.

## Repository map

| Location | Purpose |
| --- | --- |
| `router.mjs` | Local router/API entry point. |
| `electron/` | Desktop window, tray and lifecycle. |
| `host/` | Device ownership, profiles, feedback and app adapters. |
| `ui/` | Desktop/browser panel, SVG icons and bundled guides. |
| `config/` | Generic starting profiles and settings; no personal projects. |
| `integrations/ct-td-control/` | Device/TD bridge with its separate locked dependencies. |
| `scripts/` | Build tools and focused regression checks. [Checks guide](CHECKS.md). |
| `docs/` | User walkthroughs, screenshots, testing and source documentation. |
| `third-party/` | Dependency notices and provenance. Keep these. |
| `waxyct.bat` | Windows convenience launcher for browser/router mode; legacy internal naming is retained for compatibility. |

The many `check-*.mjs` files are tests, not runtime clutter. They remain grouped under `scripts/` to preserve imports and reproducible commands. Generated dependencies, caches, backups and packages belong outside source control.

## Packaging and contributions

`npm run package` uses the public portable packaging path. It is distinct from later local NSIS installer candidates. See [release status](RELEASE-STATUS.md) before distributing a binary.

Keep changes focused and include a regression check for changed behaviour. Preserve autosave/Undo, page/shared scope and device ownership rules. Do not remove a profile or adapter merely because your setup does not use it. Report bugs in [Issues](https://github.com/adrienwax/ctserver/issues); vulnerabilities go through [private reporting](https://github.com/adrienwax/ctserver/security/advisories/new).
