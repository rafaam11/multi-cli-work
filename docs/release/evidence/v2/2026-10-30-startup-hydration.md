# Startup hydration correction after candidate CI

Candidate CI [41016762487](https://github.com/rafaam11/multi-cli-work/actions/runs/41016762487) exposed two failures before publication. Stable/latest remained v1.55.1.

- Windows native terminal E2E clicked the visible session button, then remained on Home. A deterministic delayed-provider regression reproduced an older initial terminal snapshot deleting a newly received session. Startup now replays lifecycle events over the snapshot and preserves navigation that occurred while the initial read was pending. Removed sessions do not reappear.
- Independent review caught saved-layout/hidden-shelf loss in the first repair, then a page mismatch when restored slots moved the selected pane to a later page. Both were fixed with failing regressions. Saved same/other-folder layouts, hidden membership, explicit early hide actions, and the selected pane's final visible page are covered. Final scoped review reported no blocking findings.
- Linux source and packaged GUI, native bridge, strict OpenSSH, and the actual original deb offline v1 → v2 → v1 → v2 roundtrip passed. The additional first-start failure scenario stopped while trying to rename the root-owned `/opt` executable, before exercising rescue. The fixture now uses its existing disposable-runner sudo privilege for that deb-only fault injection; package permissions remain intact. AppImage and Windows retain ordinary fixture-owned renames. This scenario still requires a new CI result.

Final local verification after all hydration review fixes (Windows, 2026-10-30):

- All 171 App tests passed in 51.40 seconds, including eight new regression cases relative to the earlier full-suite checkpoint.
- `npm run build:v2`, web TypeScript, strict E2E TypeScript, and diff checks passed.
- Source Electron: three passed, one packaged-only scenario skipped (61 seconds).
- Then, sequentially, the actual stable-identity `2.0.0` package was rebuilt. Six ASAR checks and all four packaged Electron scenarios passed (68 seconds), including the asserted application version.

The earlier 2,733-test full-suite checkpoint is preserved as historical evidence. The updated source requires the new candidate's full Windows/Linux CI run before stable gates can pass. Android functionality/device validation remains deferred.
