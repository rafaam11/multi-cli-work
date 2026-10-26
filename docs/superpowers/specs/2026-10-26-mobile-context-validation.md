# Mobile context validation

Implementation: project/path overlay navigation, CLI-owned touch history, host generation/seen synchronization, durable Android sound budget and notification context.

## Verified locally

- TypeScript typecheck and production build pass.
- Final full Vitest after review fixes: 217 files, 2182 tests pass. Windows exhausted memory with two threads; one fork worker completes reliably.
- Android JUnit: 51 tests, zero failures/errors. Debug APK assembles with shell versionCode 4 / versionName 0.3.0.
- Mobile Playwright: three tests pass. Real shell scrollback exposes the first of 120 lines; real xterm fixtures in both normal-buffer mouse mode and alternate-buffer mode render earlier answer text after a touch drag.
- Drawer/browser Back preserves the terminal DOM node and sends no additional attach or resize. Project/path identity, unknown legacy paths, and transient history navigation have unit coverage.
- Visually inspected 390 x 844 screenshots with the drawer open and after viewing earlier text. The drawer uses an overlay; the header shows current project/path, with full-path disclosure.
- Causal tests cover stale acknowledgments, current PC viewing, non-attached rejection, persisted restart state, one approval escalation, working/waiting flapping, silent updates, notification eligibility, host isolation and offline seen reconciliation.

## Installation and remaining device checks

Both the PC build and Android shell 0.3.0 are needed for the full lifecycle behavior. The protocol remains v1 with optional fields and capability `session-seen-v1`. Older hosts remain connectable; the Android ongoing notification explains that PC confirmation sync needs a PC update.

A fresh read-only review identified two issues, fixed with covering regressions: hidden desktop layout slots could count as views, and older host-served JavaScript could not report phone viewing. Desktop exposure now has a separate transient IPC signal that excludes detail/home and zoom-hidden panes, preserving the existing desktop badge policy. The Android shell observes rendered legacy terminal content and native foreground state for local phone confirmation; new generation-aware frontends retain their own reporting. Legacy observation does not provide PC confirmation sync.

## Initial implementation decisions

- Initially preserved the clean shared checkout at `07314f8` and implemented in the native managed detached worktree. The initial scope covered local commits; the subsequent user-requested integration is recorded below.
- Continued inline when the implementation agent did not initialize; no agent edits were lost. A separate reviewer examined the completed branch, and both substantive findings were fixed in one pass with regression coverage.
- Used one fork worker after Windows memory exhaustion with two threads. This increases test time and leaves the test coverage unchanged.
- The review deferred physical-device judgment because there was no device evidence; the remaining checks above are intentionally reported as unverified.

No ADB device was connected during validation. Physical Android WebView, lock-screen sound/dismissal behavior and installed Codex/Claude scrolling still require a device check; browser fixtures do not establish those results. The debug APK was built locally, not installed over the user's signed app. No release, tag, push or publication was performed.

## Main integration, 2026-10-27

- User requested one local branch and one checkout. Integrated the mobile work at `b6ecaab` with v1.52.0 in `059edb6`, then combined the newer `origin/main` changes through v1.53.0 (`4b4fa06`). Both histories are preserved.
- Resolved navigation, theme, terminal and protocol conflicts while retaining remote grid mirroring, mouse selection, host labels, project/path navigation, scrollback and durable attention state. The current exposed terminal supplies seen acknowledgments; zoom-hidden peers and document views do not. A regression reproduced and verified this intersection.
- Final full Vitest: 231 files / 2,312 tests pass. Typecheck and production build pass. Android's unchanged source retains 51 passing tests; unit-test and debug-APK Gradle tasks complete successfully.
- Final desktop/mobile/remote E2E run: 33 passed and one localhost pairing failure. The failed remote-window test then passed unchanged in isolation, covering all 34 selected cases. The initial connection failure's cause remains unconfirmed. Mobile drawer/history and the remote zoom screenshot were visually inspected.
- Corrected an existing desktop E2E assertion to search the target terminal's history for delivered line notes, since PowerShell's later parser output can scroll the prompt out of a narrow pane. The complete desktop suite passed after the correction.
- Windows commit memory reached 96–97%; an unbounded esbuild process failed allocation. The successful build used `GOMAXPROCS=2`, `GOMEMLIMIT=256MiB`, and a 2 GiB Node heap. The full Vitest suite used one fork worker. Logs, including failed attempts, remain under `.superpowers/integration`.
- Copied 43 evidence files from the old worktree to `.superpowers/integrated-worktree-a17b` and verified their hashes. Cleanup follows verification that both integration inputs are ancestors of `main`; the shared dependency junction must be unlinked without deleting its target.
- Integration is local. Existing Dependabot remote PR branches remain outside this cleanup. No push, release, or device installation was performed.
