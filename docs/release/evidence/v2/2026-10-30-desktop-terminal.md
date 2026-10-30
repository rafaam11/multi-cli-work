# Desktop terminal conformance and multiple sessions

New `e2e/herdr-desktop.spec.ts` exercises the real Electron Canvas, host, native bridge and pinned Herdr. Its disposable Rust terminal probe enables native VT input and records bytes received by the actual terminal process. The probe is a Cargo example used only by E2E; it is not a shipped app binary.

Windows observations:

- Chromium CDP Korean composition is visible at the terminal cursor and commits exactly once. This tests Chromium's composition path, **not a physical Windows input-method keyboard session**.
- Real system clipboard paste reaches the terminal once, including bracketed-paste delimiters and multiline Korean text.
- Pointer selection copies Korean text; scrollback moves to the top and back to the bottom. SGR mouse press/release reaches the process with the expected coordinates.
- A Kitty RGB image travels through Herdr and the native bridge; Canvas pixel inspection finds the expected red image. Screenshots were also visually inspected.
- 15 unique Herdr tabs/root panes remain connected. Six terminal Canvases display concurrently. Fourteen hidden sessions produce output while the GUI is hidden. A task question received while hidden remains unread after returning and after hiding its session from the workspace; global All/Waiting still includes it.
- The source run created the additional 14 sessions in 5.4 seconds and restored the hidden question display in 0.2 seconds. These are one local measurement, not a cross-machine performance guarantee.

The actual browser test first failed because composition used a nearly transparent 1px textarea fixed at the viewport origin. The input now follows the terminal cursor, displays composition text and discards unfinished composition on lost control/disconnection. A screenshot then exposed clipped Korean glyphs after Windows initial resize: the wire frame sometimes retains ordinary blank spacer cells instead of explicit empty tails. Rendering and selection now recognize a single matching blank after a Unicode wide grapheme, preserving actual word spaces and adjacent text. Both defects have focused regressions.

Verification: 21 focused renderer tests; full bounded suite 308 files / 2,676 tests passed, 2 files / 5 tests intentionally skipped; Rust bridge tests passed; complete build/typechecks and strict E2E types passed; workflow YAML parsed. Source native desktop scenario passed in 16.1 seconds. Unpacked preview package and actual ASAR check passed; combined packaged desktop/GUI/phone/startup-recovery suite **4 passed in 53.5 seconds**. Windows and Linux CI now build the disposable native probe and run this scenario against source and packaged applications.

Linux CI for this change is pending at this checkpoint. No Android functional/device validation was run. No stable release gate was marked passed and no stable/latest publication occurred. This checkpoint does not close the remaining terminal menu parity, remote/worktree navigation and final release-review findings.
