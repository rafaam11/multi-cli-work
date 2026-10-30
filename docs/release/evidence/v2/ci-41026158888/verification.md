# v2.0.0 candidate verification

Source: `9476108b698e0f9791f8def8adbe3387bbffba62`. [Hosted candidate run 41026158888](https://github.com/rafaam11/multi-cli-work/actions/runs/41026158888) completed successfully on 2026-10-30. `run.json` records the exact commit, all job steps, and artifact digests. Every report in this directory was retrieved from those artifacts; raw logs and credentials are not published.

| Check | Windows | Linux |
| --- | --- | --- |
| Full direct Vitest suite | 315 files, 2,743 passed; 6 skipped | 315 files, 2,742 passed; 8 skipped |
| Dedicated provider hook fixtures | 10 passed | 10 passed |
| Actual pinned Herdr broker | 36 passed, 1 platform skip | 38 passed |
| Native Rust protocol bridge | 17 passed | 16 passed |
| Source Electron scenarios | 3 passed, 1 packaged-only skip | 3 passed, 1 packaged-only skip |
| Packaged Electron scenarios | 4 passed | 4 passed |
| Actual SSH transport | Native Windows scenario passed separately on this commit | Isolated OpenSSH scenario passed in CI |

The separate [Windows SSH record](../2026-10-30-windows-native-ssh.md) documents strict host-key discovery, forwarding, ownership/input, offline result storage and exactly-once delivery without stopping the existing system SSH service. Its controlled executor is not a paid-model run. The earlier [real Claude/Codex cooperation preflight](../2026-10-30-windows-provider-cooperation.md) is separate historical evidence; it is not relabeled as a fresh final-candidate model invocation.

Source and packaged Electron scenarios use actual Herdr processes, input and native screen events. They verify Korean composition/commit, clipboard, selection, native scrollback/search/clear, pointer reporting and Kitty pixels; 15 managed sessions with six visible panes; hidden question unread state; GUI quit/reopen and authenticated host restart with the same pane identity. The browser gateway exercises viewing/control ownership and reconnection with existing pairing. These checks are desktop/browser checks, not Android verification. The terminal reports record their observations and measured creation/restore timings.

Event-loss and replay boundaries are additionally covered by the passing `api-client`, `task-executor`, `worker-executor`, `remote-workers`, `remote-operations`, `host-connections` and `task-store` tests. They retain stale/unknown observation, reconcile lost acknowledgments, keep worker results locally while disconnected, and reject ambiguous command replay. GUI lifecycle scenarios prove native process and pane continuity rather than merely asserting stored metadata. Result review remains separate from integration.

The packaged screenshots in this directory were inspected. Windows and vanilla Linux display Korean composition glyphs; Linux search text is visible under selection, controls stay inside the pane, and remote project labels render Korean. The bundled font is local and preserves Latin monospace fallback. `visual-review.json` records the image hashes and inspection scope. Chromium composition automation does **not** certify a physical OS keyboard/IME.

| Original installation scenario, network blocked | Full v1 → v2 → v1.55.1 → v2 | First v2 Electron launch deliberately prevented |
| --- | --- | --- |
| Windows NSIS | Passed, 58.1 seconds | Independent offline rescue passed, 35.4 seconds |
| deb | Passed, about 1.2 minutes | Independent offline rescue passed, 42.9 seconds |
| AppImage | Passed, 33.7 seconds | Independent offline rescue passed, 19.6 seconds |

The six source-bound recovery reports confirm the original 1.55.1 version, immutable backup identity, both data generations, Local Storage notes/favorites, suppressed v1 updater/resume/repository synchronization, preserved Git/worktrees, and unmerged v1 changes on returning to v2. First-start rescue runs outside the replaced installation before Electron/data cloning. Linux uses a loopback-only network namespace; Windows blocks the recovery fixture's executables as recorded in its report. Original installers ran only on disposable CI machines.

Failure handling is covered by recovery tests for injected ENOSPC/EACCES, interrupted preparation, installer failure, changed backup bytes, shared-settings conflicts, unknown/running host state, native residual GUI detection, updater cache quarantine, and durable owned-worktree removal. This does not claim physical disk exhaustion or an uncontrolled power-loss experiment.

The upgrade fixture uses the original installed app identity with a preview-version candidate to isolate it from stable/latest. The final tag workflow separately builds and tests the actual stable v2.0.0 identity before publication. Candidate CI itself does not publish a release or update manifest.

Android functional/device verification remains deferred by the user's explicit instruction. The APK build and pinned-signature check passed; none of the eight deferred Android checks are recorded as passed.
