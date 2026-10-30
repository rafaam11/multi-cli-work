# Recovery controller checkpoint, 2026-10-30

This is implementation and automated regression evidence, not approval of the original-installer roundtrip gates.

The desktop now stages a verified standalone controller and native process observer outside the installation. Recovery uses durable local/global and remote/task admission holds. Active terminal observation and messages remain available; unknown responses are inspected without dispatch replay. Cancellation releases remote scopes first. Fresh observations surround preservation copies. Native process identities, residual instance checks, original installer hashes, installed version inspection, updater-cache quarantine and safe restored settings govern installation and launch. Both GUI and independent entry suppress the GUI updater quit hook. Interrupted installation/activation blocks a fresh attempt.

The Settings update page reads status on entry. Restoration starts only after the user selects the concrete recovery action. Packaged installations also preserve begin/status/cancel launchers. Host startup failure with an unavailable daemon still needs offline store/process reconciliation; it is not covered by the current begin command.

Verified locally on Windows:

- Full suite checkpoint: 296 files / 2,623 tests passed, 2 files / 4 environment-dependent tests skipped, 196.00 seconds. Dedicated real provider-hook tests: 10 passed. This suite preceded the final primary-store/race/packaging regressions; the branch CI runs the complete final set.
- Focused recovery/host/store/IPC/UI/settings checkpoint: 153 tests passed. Additional RED-to-GREEN regressions cover a fallback `.bak` being mistaken for settled work, cancellation before controller identity publication, concurrent recovery creation, and a required module omitted from the ASAR.
- Source GUI scenario: 20.9 seconds passed, including the preserved controller adapter with an actual running Herdr shell. The admission hold blocked new sessions, displayed pending work, and explicit cancellation reopened admission. The fixture invokes no installer method.
- Packaged GUI scenario after the module fix: 19.9 seconds passed. It also covers GUI exit/reopen, daemon crash/reconnection without duplicate launch, metadata, remote cached results, and worker selection. Recovery UI screenshots were inspected for legibility.
- Actual ASAR dependency inspection passes for all 6 shipped desktop JavaScript modules. A prior artifact failed this check because a shared desktop chunk imported an excluded MCP executable entry. Connection-file reading now lives in a regular shared module. CI executes packaged Windows and Linux GUIs after packaging.
- Typecheck, v2 build, Windows preview packaging and preview release gate pass. The gate reports **0 passed / 8 Android deferred / 31 total**; no stable release was published.

No original installer was executed on the development PC. Windows, deb and AppImage offline installation/data restoration/reupgrade, unavailable-host recovery, and their failure cases remain required. Android verification remains deferred by the user's explicit instruction; its implementation remains in scope.
