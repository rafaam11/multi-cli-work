# Final local font and regression verification

Candidate: `9476108b698e0f9791f8def8adbe3387bbffba62`.

On Windows x64, 2026-10-30, the direct full-suite command completed with **315 files / 2,743 tests passed; 3 files / 6 tests skipped**, in 295.88 seconds. The provider cooperation, native OpenSSH, and Linux process scenarios require their separate environments; a skip is not a pass.

```sh
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --exclude src/main/providers/claude-integration.test.ts
```

The production code is byte-identical to the preceding font candidate `9452c46fff9593339643a90b6a08ed1fa09e39cb`; the only intervening change fixes the typography test parser's handling of a leading CSS `@import`. The five typography checks first reproduced the failure and then passed with all scale assertions retained. The earlier Windows temporary-path failures were reproduced with an aliased TEMP/TMP root and corrected only in fixture construction; all 12 affected tests passed without changing production ownership checks.

The frozen production build passed type checking and `build:v2`. Source Electron verification ran serially before packaging: 3 passed, 1 packaged-only skip, 1.4 minutes. The actual stable-identity v2.0.0 unpacked Windows package passed six ASAR module checks and all four packaged Electron scenarios in 1.2 minutes. The package tests used isolated application-data roots and did not execute an installer or stop the user's other running MCW application.

The font-focused tests passed 25 checks. Actual Canvas tests loaded the bundled face, compared distinct Korean glyph rasters, and confirmed equal `i`/`W` widths when the preferred monospace font is absent. The Korean composition screenshot was inspected and readable. Extracted desktop ASAR font and license bytes matched their pinned SHA-256 values, and the independent phone gateway payload contained the font. The font is included locally; no network font provider is needed.

These observations do not claim a physical OS IME test, Android device verification, or a successful final hosted CI run. The final release ledger separately binds hosted Windows/Linux, screenshot review, and original installer roundtrips to the same candidate.
