# v2.0.2 candidate verification

Source: `e1633d907cc3ba7f94efe640d45eba6d03df670f`. [Hosted candidate run 41197110354](https://github.com/rafaam11/multi-cli-work/actions/runs/41197110354) completed successfully on 2026-10-31. `run.json` records the exact commit, all job steps, and artifact digests. Reports and screenshots in this directory come from that run, except the explicitly identified local Windows record.

This candidate repairs rejected/exited terminal resume, conversation metadata preservation, and desktop click-to-control. New hosts use generation-checked replacement with archived attempts. Existing v2.0.0/2.0.1 hosts continue running and use deterministic successor executions; repeated resume follows the same successor. Ordinary resume excludes collaboration attempts and uncertain/running executions.

| Check | Windows | Linux |
| --- | --- | --- |
| Full Vitest suite excluding dedicated hooks | 319 files passed, 3 skipped; 2,779 tests passed, 6 skipped | 319 files passed, 3 skipped; 2,778 tests passed, 8 skipped |
| Dedicated provider hooks | 10 passed | 10 passed |
| Actual pinned Herdr broker | 43 passed, 1 platform skip | 45 passed |
| Native Rust bridge | 17 passed | 16 passed |
| Source Electron scenarios | 4 passed, 2 skipped | 4 passed, 2 skipped |
| Packaged Electron scenarios | 5 passed, 1 skipped | 5 passed, 1 skipped |
| Native SSH transport | Passed locally on this commit | Isolated OpenSSH scenario passed in CI |

Source and packaged scenarios exercise actual Herdr processes and native screen events: terminal click and input focus, natural shell exit, explicit resume, post-resume input/output, failed executable admission/recovery, Korean Chromium composition, paste, selection, native scrollback/search/clear, pointer reporting, Kitty pixels, 15 managed sessions with six visible panes, hidden question unread state, GUI quit/reopen, and reconnect without duplicate work. The optional original-2.0.1 compatibility scenario is skipped in hosted CI and was run separately on Windows with the actual original application and its surviving host.

`windows-local-verification.json` records successful source and stable-package compatibility scenarios, native Windows SSH, the local stable NSIS payload check (160 entries, all 7 required Herdr files), and an actual installation over 2.0.1. The host instance and all 15 existing execution generations/pane IDs survived unchanged. A previously rejected PowerShell was resumed through the installed GUI; clicking its Canvas acquired control and the shell printed `MCW_2_0_2_INPUT_OK`. Existing provider work was preserved. That installed package was built from `aac697be9c3bc39747a80998ad731041d76966ce`; the release candidate adds only the two verification-fixture corrections described below, with identical application sources. Native Windows SSH was rerun on the final candidate.

The hosted Windows preview NSIS payload contained 159 entries and all 7 required Herdr files. Its original-identity installation roundtrip also verifies hashes of files actually installed by NSIS. Stable builds include updater metadata, accounting for the additional local archive entry.

| Original installer scenario with network blocked | Full v1 → v2 → v1.55.1 → v2 | First v2 Electron launch deliberately prevented |
| --- | --- | --- |
| Windows NSIS | Passed | Independent offline rescue passed |
| deb | Passed | Independent offline rescue passed |
| AppImage | Passed | Independent offline rescue passed |

The six source-bound recovery reports confirm original v1.55.1 restoration, immutable backups, both data generations, Local Storage notes/favorites, disabled v1 updater/resume/repository synchronization, preserved Git/worktrees, and unmerged v1 changes on returning to v2. These original installers ran only on disposable CI machines. The recovery candidates use the preview version with the original app identity; the final tag separately builds and verifies stable v2.0.2 packages.

An earlier candidate run exposed two verification timing defects: ASAR 3 returns its output stream before all writes finish, and a successful v1 quit can close the debugger before the evaluation reply arrives. The fixtures now await the completed write stream and require a clean process exit after the specific debugger-close response. The final candidate reran both complete platform jobs successfully.

`visual-review.json` binds the inspected packaged screenshots and their hashes. Chromium composition and screenshot inspection do not certify a physical OS keyboard/IME. Phone-gateway browser checks do not certify Android devices.

Android functional/device verification remains deferred by the user's explicit instruction. APK build/signature checks were performed; none of the eight deferred Android checks are marked passed.
