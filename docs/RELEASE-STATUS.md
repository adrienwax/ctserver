# Public release status

[← CTserver](../README.md)

Public source is available. A self-contained, unsigned Windows x64 test download is being prepared locally; it has not yet been uploaded.

Completed locally: offline regressions and settings-preservation checks; native launch, populated MAP view and normal app exit in a private profile; package notice/hash reconciliation and Windows-native-module provenance. The prior local portable candidate also passed extraction, populated MAP navigation and normal quit; its process tree exited and managed temporary files were removed. The public download must be built from a committed source revision and checked as that exact artifact. Release-specific checksums and acceptance results belong with its release notes; the earlier private-tree candidate is not the public download.

The Windows build replaces four pinned loupedeck emitter imports with Node's built-in emitter and omits strict-event-emitter. The missing upstream notice was not invented or declared resolved: that implementation is not shipped in the Windows package. Dependency changes require renewed compatibility review.

Signing and a second-PC check remain open. Any initial download must be labelled an unsigned test prerelease, not a signed stable release. There is no hardware or every-app acceptance claim from offline checks. No Sandbox is required to run the portable app.

Generic profiles do not include third-party software, personal projects, media or private ATLAS content. Existing CTserver settings are retained in `%APPDATA%/waxyct`; the download does not silently replace an existing startup shortcut.

[Dependency notices](../THIRD-PARTY-NOTICES.txt) · [Asset notices](../ASSET-NOTICES.txt) · [First mapping](FIRST-MAPPING.md)
