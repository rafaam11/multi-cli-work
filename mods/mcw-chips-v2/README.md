# MCW v2 display metadata

This session-local mod is derived from the user's `rafaam11/jinmin-mods` mcw-chips 0.1.0 at commit `5d596a95ca9e3c78c607eb250a696b1bf63d9df6` (author JinminKim). The model, parser and observation hooks retain their original behavior. The transport is replaced with Herdr 0.9.5 `pane report-metadata`; no jk command, credentials or compatibility transport is included.

MCW loads version 0.2.0 through `--plugin-dir` for its own Claude sessions. It does not update the installed v1 plugin, its settings or the marketplace. The separate plugin name/state namespace and `/chips-v2` command allow both versions to remain installed. The v2 mod activates only with the MCW v2 session and Herdr pane identity. Companion and HUD continue to receive the existing project brief/session identifiers.

The six chip keys and progress token are display-only, limited before sending, with a 90 second expiry and 45 second refresh. Changes are coalesced for 750ms; an uncertain command is not replayed. A later observation publishes the current display. Shutdown clears are serialized after any pending report. Values never mark a task complete, approve a request or merge code.
