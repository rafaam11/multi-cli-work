# Pre-Electron rescue staging

Implemented independent rescue staging before Windows replacement, and before the Linux deb/AppImage launcher invokes Electron. A failed first Electron launch can use the external pinned Node/controller/original-installer bundle. The first rescue preserves verified original data and mods before creating a recovery-only host. Existing v2 state without provenance and unknown remote work are blocked.

Local evidence (Windows, 2026-10-30):

- `startup-rescue.test.ts`: RED before initial-rescue implementation; GREEN for original path/Local Storage preservation without migration, blocked running/unknown remote work, orphaned-v2 refusal. Native replacement admission regression also observed RED then GREEN: another installation's MCW GUI blocks the legacy uninstaller; unrelated generic Node does not.
- Focused `startup-rescue`, `bootstrap`, and `offline-host` run: 19 tests passed.
- Package-hook regression: RED then GREEN for preserved Electron payload and rescue-before-exec wrapper ordering with AppImage environment retained. Integration converted this test to Vitest so the repository's full suite runs it; package-hook and stable-distribution checks pass together (3 tests).
- `node scripts/recovery/startup-stage-smoke.mjs`: passed with real pinned assets in disposable temporary paths; independent runtime and asset verification survived complete removal of the simulated installation. v1 data stayed unchanged; no Electron or installer executed.
- A live `stage-install` safety probe refused an existing other-path MCW GUI and printed its native PID/executable path. No process was stopped. The generic asset smoke uses `stage` to avoid requiring closure of the user's apps.
- `npx tsc --noEmit -p tsconfig.node.json --composite false`: passed.
- `npx playwright test e2e/startup-rescue.spec.ts --list`: new disposable CI scenario discovered. This is discovery evidence, not execution evidence.

Integration also built the Windows preview NSIS installer with the pre-replacement hook and passed ASAR checks plus four packaged GUI scenarios (58.7 seconds). The original installer was not executed. Stable configuration had overwritten the hook with the legacy base configuration; a failing distribution regression caught this and now passes with the explicit v2 hook retained.

Not locally performed: Linux packaging/wrapper execution or original installer execution. The Windows/deb/AppImage catastrophic-first-start offline recovery scenario is wired into existing disposable hosted-CI jobs and must pass there before claiming platform completion. Final candidate rebuild/retest remains required after review corrections. No Android evidence or release gate was marked passed.

Review corrections:

- Renamed Linux payload refusal: truncated `multi-cli-work.` / `multi-cli-work-` comm regression observed RED then GREEN. Shared GUI names include `.electron`, executable basenames are checked, and both prelaunch and normal desktop records retain the actual executable path. A Linux-only native-process test checks initial rescue and established independent recovery with `guiProcess: null`; it is skipped on this Windows machine and runs when the compiled Linux bridge is present in CI.
- Interrupted initial preparation: fault injection after final registry creation and after identity write observed RED then GREEN. A synced preparation receipt now precedes final v2 roots, binds the immutable original manifest digest and preassigned identity, and permits only its exact empty recovery footprint on retry. Foreign registry data and changed identity remain preserved and blocked.
