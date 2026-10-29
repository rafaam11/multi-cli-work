# Windows real-provider cooperation preflight — 2026-10-30

This is an automated preflight, not a completed stable-release gate. The manual validation ledger remains pending and Android verification remains last.

Environment: Windows x64, pinned Herdr 0.9.5 and native MCW bridge, standalone Node 22.12.0 task MCP client, Claude Code 2.1.312 and Codex CLI 0.165.0. Each CLI used its configured default model. The test exercised the current `codex/herdr-v2` implementation through a disposable local repository, a separate lead directory and distinct worker worktrees. No merge, push, repository reset, user trust-setting update, or original installer execution occurred.

Command: `MCW_PROVIDER_PROBE=1 node node_modules/vitest/vitest.mjs run src/main/host/provider-cooperation.test.ts --maxWorkers=1 --reporter=verbose` (set the environment variable using the platform shell).

Observed result: **1 test passed in 58.01 seconds**. The earlier peer/result-only probe also passed in 33.87 seconds.

| Observation | Result |
| --- | --- |
| Both workers announce READY; lead then sends GO | Persisted in the task event stream |
| Claude worker and Codex worker each send a targeted PEER_HELLO | Both target/from pairs verified |
| Each worker reports the peer ID actually received | Both result verification fields checked |
| Lead receives both worker results and submits separately | 3 unique participant results |
| Result integration/review | All `unintegrated` and `pending` |
| Later explicit user message | All 3 participants send `MCW_WAKE_CONFIRMED` |
| Results after wake-up | Still exactly 3; no duplicate submission |
| Wait interface | Actual `task_wait` calls recorded |
| Primary Git checkout | Clean; base retained |

The final stored task had 13 events and 3 results before fixture cancellation. Request-shape diagnostics confirmed Claude sends `claudecode/toolUseId` and `progressToken` inside `_meta`; no credentials or request content are included in those diagnostics. Raw fixture logs/transcripts remain local and are not release assets.

Fixture isolation: Claude uses separate config directories with copied existing authentication and model settings, read/task-tool permissions, and trust for this test's own paths. Authentication/settings copies are removed during teardown. Codex receives a process-local trust table for the test repository and worktrees, a read-only sandbox, and the existing authenticated CLI profile. No trust or approval dialog is accepted by UI automation. The host still enforces task/participant/attempt/generation authority independently of client tool annotations.

Limits: one PC, one selected team, and one simple read-only task. This does not verify remote dispatch, disconnected result delivery, writing/merging changes, physical IME/mouse/images, 15-session performance, installed companion/HUD compatibility, offline installer rollback, or Android. Stable/latest remains unchanged.
