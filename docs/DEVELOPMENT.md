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

For personal development, keep settings outside the checkout so app edits do not change the generic templates tracked by Git. From the repository root, seed a separate folder once, then set `WAXYCT_CONFIG` in each development shell:

```powershell
$ctDevConfig = Join-Path $env:LOCALAPPDATA 'CTserver-dev/config'
if (-not (Test-Path -LiteralPath $ctDevConfig)) {
    New-Item -ItemType Directory -Path (Split-Path $ctDevConfig) -Force | Out-Null
    Copy-Item -LiteralPath './config' -Destination $ctDevConfig -Recurse
}
$env:WAXYCT_CONFIG = $ctDevConfig
node node_modules/electron/cli.js .
```

An existing folder is left untouched. This environment setting applies to the current shell and its child processes; it does not change your installed CTserver settings or Windows startup. Quit another CT owner normally before launching the development app.

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

`npm run package` creates a bundled `CTserver.exe` portable download. The icon generator requires Python and Pillow; the **Pillow** version is pinned in `scripts/requirements-icons.txt`.

The current packaging run used **Python 3.7.9 and Pillow 9.5.0**. This records the tested environment, not a recommendation to install an old Python release; compatibility with newer Python versions has not been verified for this build. Use an isolated environment for build dependencies. With your chosen Python interpreter available as `python`:

```powershell
python -m pip install -r scripts/requirements-icons.txt
python -c "import sys, PIL; print(sys.version); print(PIL.__version__)"
$env:KRAB_BUILD_PYTHON = (Get-Command python).Source
npm run package
```

If you use another interpreter path, run that same interpreter with `-m pip` and set `KRAB_BUILD_PYTHON` to its executable; the builder must use the environment containing Pillow. No Python installation is needed to run the downloaded CTserver.exe.

`node scripts/package.mjs --candidate` selects a private test identity; `--installer` produces a separate optional NSIS installer. Packaging checks fonts/notices before building, and the Windows stage omits other-platform drivers and dependency test fixtures. See [release status](RELEASE-STATUS.md) before distributing a binary.

Keep changes focused and include a regression check for changed behaviour. Preserve autosave/Undo, page/shared scope and device ownership rules. Do not remove a profile or adapter merely because your setup does not use it. Report bugs in [Issues](https://github.com/adrienwax/ctserver/issues); vulnerabilities go through [private reporting](https://github.com/adrienwax/ctserver/security/advisories/new).
