# First-use check: CTserver

[← CTserver](../README.md) · [Make a mapping](FIRST-MAPPING.md)

For a candidate supplied privately by the maintainer. There is no public signed installer yet. Use a disposable test environment and report Windows warnings rather than disabling security to get past them.

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
