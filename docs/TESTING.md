# First-use check: CTserver

[← CTserver](../README.md) · [Make a mapping](FIRST-MAPPING.md)

Download [CTserver.exe from the rc1 test release](https://github.com/adrienwax/ctserver/releases/download/v1.0.0-rc.1-test/CTserver.exe). This is an unsigned portable Windows x64 app, not an accepted stable release. Use test mappings and report Windows warnings rather than disabling security. No Sandbox, installer or separate runtime download is required.

The exact release EXE passed a private-profile launch/MAP/normal-exit check on the maintainer’s PC. A second-PC check and signing remain open; the steps below are a feedback checklist, not a claim that every app profile or hardware setup is validated.

## Start without the controller

1. Open the app. Can you distinguish **LIVE**, **MAP** and **DIAGNOSE**?
2. Follow [Map your first key](../README.md#map-your-first-key) through binding and label editing. Is the selected key and page/shared scope obvious?
3. Wait for Saved, use Undo/Redo once, quit through the tray, and reopen. Is the intended mapping retained?
4. For the portable download, reopen the same CTserver.exe and confirm the mapping remains. There is no installer or uninstaller in this download; use test data only.

## If a device check is needed

Quit the previous device owner normally. Connect the CT, activate the intended profile and try one action whose target app is available. Check that the app/device labels agree. Do not repeat every key just because the software version changed; focus on the changed behaviour or a reported problem.

## Useful feedback

- Where did you first have to guess what to click?
- Was it clear that **Bind**, **autosave** and **Activate on CT** do different jobs?
- Did X-versus-tray-Quit behave as the guide explained?
- For a failure: version, Windows version, profile/page, connection state, steps and expected/actual result.

Remove private launch paths, endpoint tokens and unrelated profiles from attachments. [Issues](https://github.com/adrienwax/ctserver/issues) are for bugs; [private reporting](https://github.com/adrienwax/ctserver/security/advisories/new) is for vulnerabilities.
