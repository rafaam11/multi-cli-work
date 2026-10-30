# Unavailable-host recovery checkpoint, 2026-10-30

This checkpoint does not pass the original-installer roundtrip release gates.

The independent recovery controller now supports a host that has exited or never started. It obtains the same runtime lock used by `mcw-host`, checks native process birth identities, reads only valid primary work records, and exposes only recovery admission/readiness/release operations. A live or unobservable daemon, surviving terminal, missing launch identity, unknown local dispatch, or undelivered result blocks progress. Remote dependencies remain explicit; a local process check does not certify remote work. The controller retains the daemon lock through preservation and installation. It never replays a launch or converts an old idle/lost work record to a submitted/completed result.

The host records its own kernel identity before terminal initialization. Packaged startup preserves the independent installation description and launchers before starting the daemon. Failure before recovery assets and initial backup have been staged is still outside this checkpoint; installer-time recovery staging remains to be covered.

Additional corrections:

- A later launch cannot silently replace a missing immutable v1 snapshot or change its source roots after v2 initialization.
- Windows 8.3 path aliases are accepted only when they resolve to the same kernel file identity. Every lexical ancestor still rejects links/junctions. This fixes the `RUNNER~1` failure in CI run 40990501324; that run's Linux job passed and its Windows source GUI job failed before this correction.
- Replaced Linux runtime files whose `/proc` path ends in ` (deleted)` still block recovery.
- The pinned original deb was inspected directly. Its executable is `/opt/Multi CLI Work/multi-cli-work`, independently of the preview installation directory. Recovery now verifies and launches that destination.
- Legacy pending result outboxes cannot be treated as settled work.

Local Windows evidence:

- Full regression: **300 files / 2,642 tests passed**, 2 files / 4 environment-dependent tests skipped; 197.19 seconds. Dedicated provider-hook tests: **10 passed**. These hook tests do not validate a new authenticated Claude/Codex conversation.
- Recovery/host/bootstrap focused set: **106 passed**. RED-to-GREEN cases include NTFS short aliases, Linux deleted runtimes, lost/unknown local attempts, primary versus backup authority, legacy pending results, and immutable backup origin changes.
- Typecheck and complete v2 build passed.
- Source GUI test: **20.8 seconds passed**, including live-host hold/cancel and the preserved controller after the fixture daemon exited. Work records remained byte-identical.
- Windows preview packaging, actual ASAR dependency inspection (6 modules), and the packaged GUI scenario (**21.0 seconds**) passed. The preview gate still reports 0 passed / 8 Android deferred / 31 total; it performs no publication.
- The local PC has other MCW application instances. The offline probe verified that they block installation and did not close them. Isolated CI requires no residual MCW application and exercises the full stopped-host progression. Neither probe invokes an installer.

Original Windows/deb/AppImage install, rollback, launch, reupgrade, offline network conditions and failure injection still require separate disposable-runner verification. Android device validation remains deferred by the user. No stable release or update manifest was published by this checkpoint.
