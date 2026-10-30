# Final local Windows candidate verification

The final functional implementation and version `2.0.0` were verified in an isolated worktree on Windows on 2026-10-30. Original installers were built but were not executed on the developer's PC. The release manifest remains pending until the final candidate completes disposable hosted CI.

- Full Vitest suite: 314 files / 2,733 tests passed; 3 files / 6 tests skipped. Duration 248.25 seconds. Provider hooks were isolated from this run and separately passed all 10 tests.
- Native bridge: 17 tests passed, including native Windows process identity and boot identity.
- `npm run build:v2`: passed, including TypeScript and production renderer/host builds. Strict E2E type checking passed.
- Independent rescue staging with actual digest-pinned assets: passed after removing the simulated installation; original data remained unchanged. No Electron or installer execution was needed for this smoke.
- Source Electron: three scenarios passed (57.6 seconds); the packaged-only startup-failure scenario was skipped as intended.
- Actual stable-identity `2.0.0` Windows unpacked package: six ASAR module checks and all four Electron scenarios passed (65 seconds). The GUI scenario asserted `app.getVersion() === '2.0.0'` with stable runtime selection.
- These scenarios cover native Herdr input/scrollback/selection/search, Korean Chromium composition, clipboard paste, mouse, graphics, 15 sessions with hidden activity, host survival after GUI closure, reconnect, desktop-browser phone gateway, actual host-owned Git worktree removal, cached remote project hierarchy, and independent recovery availability before data cloning.
- Final screenshots of the remote project hierarchy and scrollback search were inspected. Search remains inside the pane and selection preserves readable foreground glyphs.
- Independent code review closed the worktree deletion, interrupted initial rescue, Linux GUI process recognition, terminal protocol wiring, and remote project mapping findings before the final suite/build.

Limits: Chromium composition is not a physical OS keyboard IME test. The phone gateway runs in desktop Chromium, not Android. Android functionality/device checks are deferred by user instruction. The final Windows/deb/AppImage original-installer offline roundtrips and first-start executable-failure rescue remain CI checks; this file does not mark them passed. The earlier real Claude/Codex cooperation evidence is recorded separately; the latest personal Claude credential expired, so no fresh real-provider result is claimed here.
