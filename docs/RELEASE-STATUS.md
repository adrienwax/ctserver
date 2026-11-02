# Public release status

[← CTserver](../README.md)

**Public source is available. Public Windows installers are not yet available.** The Releases page must not imply an unsigned local candidate is a signed, clean-machine-approved download.

Remaining binary gates:

1. Reconcile the exact packaged source, native dependencies, generic defaults and notices.
2. Resolve the `strict-event-emitter` 0.5.1 notice gap: its package declares MIT, but the exact package and upstream tag inspected lacked the complete notice. No replacement notice has been invented. This source repository does not vendor its implementation.
3. Complete clean-Windows install, first use, persistence, close/reopen and uninstall checks.
4. Settle signing and verify the final app, generated uninstaller and installer.

Earlier public-source checks installed dependencies with scripts disabled and passed the offline suite. Those results did not run native addon installation scripts, open the controller or establish fresh-Windows acceptance.

Profiles provide control mappings, not the third-party apps or private project files. Only claim a specific software/device workflow when it has been exercised; do not infer it from a catalogue entry or screenshot.

The original code is MIT. Dependency and asset licences remain separate: [notices](../THIRD-PARTY-NOTICES.txt), [assets](../ASSET-NOTICES.txt), [licences](../third-party).
