# Native Windows OpenSSH verification

Source candidate: `e2005d5a92d2d1ab28053419d97cc5f0c98a9c21`. Completed 2026-10-30 at 15:55:22 KST. One integration test passed in 5.55 seconds on Windows x64 using native `C:/Windows/System32/OpenSSH/ssh.exe` and `sshd.exe`.

The same unchanged native fixture was rerun after the startup-hydration correction on candidate `ff118c9c71a90821aaa07ace6da0712bc6e532a0` at 16:28:49 KST. One test passed in 5.76 seconds; no system service or user credential configuration was changed.

It passed again on workflow-corrected candidate `7c3b776fe918019a88ae40147fb1fc0a30aed03d` at 16:46:15 KST (one test, 6.10 seconds). The production transport and fixture remained unchanged.

The fixture adapts the repository's Linux OpenSSH integration scenario to an isolated native Windows server: loopback-only ephemeral port, newly generated host/client keys and temporary `known_hosts`, public-key-only authentication, and a fixed authorized user. It uses its own configuration and child process. The existing system SSH service, user SSH keys, and machine configuration were not changed or stopped.

Verified through actual SSH discovery and port forwarding:

- Strict host-key verification and a Windows encoded PowerShell connection-info command with absolute runtime paths.
- Host identity and catalog discovery, task creation/start routing, messages, result reads and explicit review acknowledgments.
- Remote terminal ownership and input routed once; closing the SSH viewer leaves the host alive.
- A worker result submitted with the transport closed remains local, reaches the owner after reconnect, and appears exactly once after repeated synchronization. Worker admission count remains one.
- Changing the fixture's pinned host key rejects subsequent discovery.

Task execution uses the scenario's controlled executor; this test does not call a paid model or represent a physical two-PC performance measurement. It verifies native Windows SSH transport in addition to the separately recorded real Claude/Codex cooperation preflight.

Reproduce by copying `windows-native-ssh.fixture.ts.txt` to `.cache/windows-ssh.integration.test.ts` and `windows-native-ssh.config.mjs.txt` to `.cache/vitest-ssh.config.mjs` in a built checkout, setting `MCW_SSH_TEST=1`, then running `node node_modules/vitest/vitest.mjs run --config .cache/vitest-ssh.config.mjs --maxWorkers=1`. The fixture stops only the SSH child it owns and removes its temporary paths.
