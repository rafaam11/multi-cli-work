# Mobile context validation

Implementation: project/path overlay navigation, CLI-owned touch history, host generation/seen synchronization, durable Android sound budget and notification context.

## Verified locally

- TypeScript typecheck and production build pass.
- Full Vitest after attention integration: 216 files, 2179 tests pass. Windows exhausted memory with two threads; one fork worker completes reliably.
- Android JUnit: 50 tests, zero failures/errors. Debug APK assembles with shell versionCode 4 / versionName 0.3.0.
- Mobile Playwright: three tests pass. Real shell scrollback exposes the first of 120 lines; real xterm fixtures in both normal-buffer mouse mode and alternate-buffer mode render earlier answer text after a touch drag.
- Drawer/browser Back preserves the terminal DOM node and sends no additional attach or resize. Project/path identity, unknown legacy paths, and transient history navigation have unit coverage.
- Visually inspected 390 x 844 screenshots with the drawer open and after viewing earlier text. The drawer uses an overlay; the header shows current project/path, with full-path disclosure.
- Causal tests cover stale acknowledgments, current PC viewing, non-attached rejection, persisted restart state, one approval escalation, working/waiting flapping, silent updates, notification eligibility, host isolation and offline seen reconciliation.

## Installation and remaining device checks

Both the PC build and Android shell 0.3.0 are needed for the full lifecycle behavior. The protocol remains v1 with optional fields and capability `session-seen-v1`. Older hosts remain connectable; the Android ongoing notification explains that PC confirmation sync needs a PC update.

No ADB device was connected during validation. Physical Android WebView, lock-screen sound/dismissal behavior and installed Codex/Claude scrolling still require a device check; browser fixtures do not establish those results. The debug APK was built locally, not installed over the user's signed app. No release, tag, push or publication was performed.
