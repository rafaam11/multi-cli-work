# v2.0.1 candidate verification

Source: `a7d57f86cfe466f87c7dc0d0570c81e83452fc15`. [Hosted candidate run 41172101154](https://github.com/rafaam11/multi-cli-work/actions/runs/41172101154) completed successfully on 2026-10-31. `run.json` records the exact commit, all job steps, and artifact digests. Every report in this directory was retrieved from those artifacts; raw logs and credentials are not published.

This candidate corrects v2.0.0's Windows installer, which silently omitted `conpty/arm64/OpenConsole.exe` (7-Zip's ARM64 filter is not decodable by the NSIS extractor), so Herdr refused every terminal after installation. The same scenarios as v2.0.0 were rerun on this commit, plus the new installer checks below.

| Check | Windows | Linux |
| --- | --- | --- |
| Full direct Vitest suite | 321 files: 318 passed, 3 skipped; 2,754 tests passed, 6 skipped | 321 files: 318 passed, 3 skipped; 2,753 tests passed, 8 skipped |
| Dedicated provider hook fixtures | 10 passed | 10 passed |
| Actual pinned Herdr broker | 37 passed, 1 platform skip | 39 passed |
| Native Rust protocol bridge | 17 passed | 16 passed |
| Source Electron scenarios | 3 passed, 1 packaged-only skip | 3 passed, 1 packaged-only skip |
| Packaged Electron scenarios | 4 passed | 4 passed |
| Actual SSH transport | Native Windows scenario passed separately on this commit | Isolated OpenSSH scenario passed in CI |

New for this candidate:

- `check-nsis-payload.mjs` read the actual preview installer's embedded archive: 159 entries, every coder decodable by the NSIS extractor, and all 7 pinned Herdr Windows files present.
- The Windows roundtrip hashed every pinned Herdr ConPTY file in the NSIS-installed application after each v2 installation, and the installed app passed the new startup ConPTY bundle verification before opening its window.

The separate [Windows SSH record](../2026-10-30-windows-native-ssh.md) documents the native scenario rerun on this commit. Its controlled executor is not a paid-model run.

Source and packaged Electron scenarios use actual Herdr processes, input and native screen events: Korean composition/commit, clipboard, selection, native scrollback/search/clear, pointer reporting and Kitty pixels; 15 managed sessions with six visible panes; hidden question unread state; GUI quit/reopen and authenticated host restart with the same pane identity. These are desktop/browser checks, not Android verification. The terminal reports record their observations and measured creation/restore timings.

The packaged screenshots in this directory were inspected; `visual-review.json` records the image hashes and inspection scope. Chromium composition automation does **not** certify a physical OS keyboard/IME.

| Original installation scenario, network blocked | Full v1 → v2 → v1.55.1 → v2 | First v2 Electron launch deliberately prevented |
| --- | --- | --- |
| Windows NSIS | Passed, 1.2 minutes | Independent offline rescue passed, 42.8 seconds |
| deb | Passed, 1.2 minutes | Independent offline rescue passed, 44.7 seconds |
| AppImage | Passed, 35.5 seconds | Independent offline rescue passed, 17.4 seconds |

The six source-bound recovery reports confirm the original 1.55.1 version, immutable backup identity, both data generations, Local Storage notes/favorites, suppressed v1 updater/resume/repository synchronization, preserved Git/worktrees, and unmerged v1 changes on returning to v2. Original installers ran only on disposable CI machines.

The upgrade fixture uses the original installed app identity with a preview-version candidate to isolate it from stable/latest. The final tag workflow separately builds the stable v2.0.1 identity, checks its installer payload, and tests the packaged app before publication.

Android functional/device verification remains deferred by the user's explicit instruction; this candidate does not change the Android shell. None of the eight deferred Android checks are recorded as passed.
