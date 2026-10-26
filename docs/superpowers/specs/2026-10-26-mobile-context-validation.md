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

## Execution decisions

- Preserved the clean shared checkout at `07314f8` and implemented in the native managed detached worktree. The accepted scope covers local commits; the managed worktree is retained without publishing or merging into the shared checkout.
- Continued inline when the implementation agent did not initialize; no agent edits were lost. A separate reviewer examined the completed branch, and both substantive findings were fixed in one pass with regression coverage.
- Used one fork worker after Windows memory exhaustion with two threads. This increases test time and leaves the test coverage unchanged.
- The review deferred physical-device judgment because there was no device evidence; the remaining checks above are intentionally reported as unverified.

No ADB device was connected during validation. Physical Android WebView, lock-screen sound/dismissal behavior and installed Codex/Claude scrolling still require a device check; browser fixtures do not establish those results. The debug APK was built locally, not installed over the user's signed app. No release, tag, push or publication was performed.
