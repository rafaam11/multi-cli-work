# Windows Herdr shutdown and recovery observation

This is component evidence, not an offline installer roundtrip or a stable-release approval.

## Reproduction and cause

The digest-pinned official Herdr 0.9.5 Windows executable returned `tab.close` success while its newly created PowerShell child remained alive. The private fixture log recorded `pane session still alive after forced shutdown`; the pane then disappeared from the API snapshot. The fixture directory remained locked.

At upstream commit `2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01`, `signal_processes` opens the handle with `PROCESS_QUERY_LIMITED_INFORMATION` and calls `TerminateProcess`. The [Windows API requires PROCESS_TERMINATE](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess). MCW previously inferred exit from the missing pane, so a successful API response could incorrectly authorize recovery.

## Changes and boundaries

- MCW's managed Windows runtime is built from that exact source with two changes: termination access in the explicit signal path, and creation-time checks in shutdown ancestry. The public API and endpoint codecs remain unchanged. Its version is `0.9.5-mcw.1`.
- `herdr-build.json` records original/modified source hashes, source commit, recipe, compiler and executable hashes. The packaged runtime validates the accepted source hashes and the executable digest. Original downloaded assets and original v1.55.1 installers are retained unchanged. Linux still uses the official pinned binary.
- The native bridge exposes a read-only process snapshot without arguments or termination operations. MCW persists process identities across host restarts, tracks descendants, and requires observed kernel exit after tab/server shutdown. Unknown identities and unobservable processes block recovery. A missing pane with surviving processes is `orphaned`.
- Windows can retain an old parent PID after that PID is reused. A live test exposed an unrelated browser tree matching a new console's PID. Creation-time ordering now excludes that ancestry. No browser process was signalled. Unreadable captured descendants remain uncertain after their parent exits.
- Shutdown observation failure, updater-cache quarantine, and residual-instance checks are implemented as helpers. The production recovery coordinator/UI and actual installation roundtrips remain outstanding.

## Current verification

On Windows, the focused run passed **9 files / 54 tests** in **12.53 seconds**, including actual Herdr and native bridge execution, immediate pane close, server/process exit, metadata, terminal input, size ownership, stale observations, PID reuse, unreadable descendants, gateway refusal and non-destructive cache quarantine. Rust checks passed **3 native process tests and 13 protocol tests**. Typecheck and build passed. The full regression passed **290 files / 2,602 tests**, with two environment-dependent files/four tests skipped; the separate provider-hook run passed **10 tests**. The source GUI quit/crash/reconnect test passed in **21.0 seconds**. The failed fixture directories were retained for local diagnosis; only the independently verified orphan from the original reproduction was stopped during cleanup, and two version-negotiation fixtures were closed through their own Herdr API endpoints.

The latest Windows source runtime build before this checkpoint has executable SHA-256 `cabada356d334b16de70cf165f0bf5e719e7a3ab9a36332825627f2eee846115`. CI builds record their own digest. This does not establish a manual terminal/performance gate, a Linux runtime result for the new process observer, or any Android verification.
