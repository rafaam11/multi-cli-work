# Phone gateway under the independent host

The daemon now owns the authenticated phone gateway, pairing identities and attention
ledger. GUI shutdown leaves the gateway and terminals alive. The v2 mobile entry uses
the same Canvas terminal and task panel as the desktop. The original v1 mobile entry
and protocol-1 pairing/native notification envelopes remain available for v1 hosts.
This does not establish Android device or APK correctness.

Paired work requests use registered repository/profile selections. They cannot mint
host credentials, register hosts, select arbitrary executables or start recovery.
Lost requests are not replayed. Terminal subscriptions reconnect for observation and
require explicit size/input ownership. Revocation closes existing terminal viewers
and rejects authentication that raced with revocation.

Notification generations distinguish separate questions/results even when execution
status remains idle. Viewing requires a synchronized rendered Canvas and the visible
foreground session. Result review and task acknowledgement remain explicit actions.

Local Windows verification on 2026-10-30:

- Full regression: 306 files, 2664 tests passed; 2 files / 5 environment skips.
- Dedicated real provider-hook subprocess tests: 10 passed.
- Typechecks and `build:v2` passed. Strict v2/recovery E2E typecheck passed.
- Source Electron + desktop Chrome at 412 by 860: passed, 29.7 seconds.
- Preview NSIS package built; actual ASAR dependency check passed (6 modules).
- Packaged Electron + desktop Chrome: passed, 29.2 seconds.
- Existing v1 pairing fingerprint/token survived migration. Chrome observed without
  taking ownership, then reloaded after GUI exit, acquired ownership and sent input
  whose output was observed through the actual Herdr surface.
- Screenshots of task UI, observer Canvas and GUI-closed Canvas were retained in
  Playwright output. The task screenshot was visually inspected in light mode.

Windows, deb and AppImage ORIGINAL-installer offline roundtrips passed in
[CI 41001468829](https://github.com/rafaam11/multi-cli-work/actions/runs/41001468829)
for preceding commit `9503962a0be8f205d19efb776bd8c3f18fef7729`. That result does
not validate this later mobile change; the next CI candidate must repeat them.

No Android verification, stable tag or public/latest update was performed by this
checkpoint. The release validation ledger remains pending until the final candidate.
