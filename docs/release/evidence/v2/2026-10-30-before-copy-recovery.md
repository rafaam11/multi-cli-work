# Recovery prepared before the initial data copy

The verified immutable v1 backup now precedes a `beforeInitialize` callback which preserves the standalone recovery installation and launchers. The callback creates only the v2 host identity and empty registry; it does not start a host, provider or shared mod. Cloning copies each backup child exclusively, retaining the early identity and refusing collisions. Incomplete copies and original data remain preserved.

The first Electron run exposed `ERR_FS_CP_EEXIST` when copying onto the early-created destination root, although the Node unit fixture accepted that operation. Copying children individually fixed the actual Electron failure without allowing replacement of existing children.

Verification on Windows:

- Bootstrap and offline-controller focused suite: 19 tests passed; callback ordering, successful cloning, conflicting partial data and refusal to retry an incomplete copy are covered.
- `build:v2`, main/web and strict E2E TypeScript checks passed.
- Source GUI/desktop Chrome: 2 passed, packaged-only test skipped.
- Preview package built; actual ASAR dependency check passed (6 modules).
- Full bounded suite: 308 files / 2,673 tests passed; 2 files / 5 tests intentionally skipped. Dedicated provider hook suite: 10 passed.
- Packaged GUI/desktop Chrome: 3 passed in 34.1 seconds. The third test corrupts only its disposable v1 mod registry, observes the independent installation/launcher before any host descriptor or initialized marker, quits its own failed GUI, and uses the preserved standalone Node/controller to stop admission, observe settled work and cancel. It never calls the installer, data activation or v1 launch. The original settings and malformed mod registry remain byte-identical.

This covers failures after backup verification and before cloning, including mod discovery and partial-copy failures. It does not prove recovery from a catastrophic Electron/JavaScript startup failure before any bootstrap code can execute. No installer was run on the developer PC. Android verification was not performed and stable/latest was not published.
