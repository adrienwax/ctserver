# Public release status

[← CTserver](../README.md) · [rc1 test release](https://github.com/adrienwax/ctserver/releases/tag/v1.0.0-rc.1-test)

**Latest test:** [CTserver.exe](https://github.com/adrienwax/ctserver/releases/download/v1.0.0-rc.1-test/CTserver.exe), unsigned Windows x64 portable app. **Stable:** not yet accepted. Signing and a second-PC check remain open.

## What was checked

| Layer | rc1 evidence |
| --- | --- |
| Source | Built from committed public source [`fd80d2f`](https://github.com/adrienwax/ctserver/commit/fd80d2f155175f08aea9cff1da64d899cc10195d). The release includes its exact source archive and checksums. |
| CI | [Windows source checks passed](https://github.com/adrienwax/ctserver/actions/runs/41676502233): offline regressions, notice/UI asset pins and package-routing validation. |
| Package | Source/archive reconciliation, pinned notices/fonts and Windows-native-module provenance checked. The package contains generic defaults, not a private studio checkout. |
| Exact EXE | Launched with a private profile; MAP/app navigation rendered 39 controls without page errors; normal app shutdown exited with code 0 and released its port. Existing configuration and installed app entry points were unchanged. |
| Cleanup | The test initially retained temporary files after a Windows file-lock error. A separate guarded cleanup passed after exit; the original receipt was preserved. |

Executable SHA256:

```text
561446d2e06dcc34ffef4085735fed7a52e8cfdc9ee2eae0bc5e6c32ff28708f
```

The binary is **94,745,938 bytes**. These checks establish the specific artifact’s provenance and observed launch behaviour; they do not establish cross-machine bit-identical builds or physical-controller/every-app acceptance.

## Template limits

Generic profiles are starting points for Moshpit, Windows, Spotify and DaVinci Resolve. Target apps, shortcuts/focus and compatible control links still need to match your setup. No third-party software, personal projects, media or private ATLAS content is included. No private TouchDesigner rig is bundled.

Settings stay in `%APPDATA%/waxyct`; the download does not silently replace an existing startup shortcut. Only one application should own the CT at a time. No Sandbox is required. See [the first-use checklist](TESTING.md) for a short test on another PC.

## Dependency notes

The Windows build replaces four pinned loupedeck emitter imports with Node’s built-in emitter and omits strict-event-emitter. Its missing upstream notice was not invented or declared resolved: that implementation is not shipped in this Windows package. Dependency changes require renewed compatibility review.

[Dependency notices](../THIRD-PARTY-NOTICES.txt) · [Asset notices](../ASSET-NOTICES.txt) · [First mapping](FIRST-MAPPING.md)
