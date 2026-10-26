# Mobile Context Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Implement tasks in order with focused RED/GREEN tests and independent reviews. User already approved implementation; do not ask for another handoff approval.

**Goal:** Identify mobile sessions by project/path, read earlier terminal output, and notify once until seen with one approval escalation.

**Architecture:** Extend the existing remote protocol additively. Reuse the mobile terminal and desktop filtering; add an overlay navigation component. Add durable host wait/seen generations and durable native notification state, integrating foreground viewing over the current authenticated connection.

**Tech Stack:** React/TypeScript/xterm 6, Electron/Node, Kotlin/Android, Vitest/Playwright/JUnit.

**Spec:** `docs/superpowers/specs/2026-10-26-mobile-context-design.md`

## Global Constraints

- Drawer min(86vw, 320px), default closed; no terminal remount or PTY resize on toggle.
- Keep tabs and existing wide layout; no transcript viewer, no unlimited history, no raw-output mutations.
- Group identity is projectId + actual cwd. Preserve per-group session order and host-specific expansion storage.
- Input one audible alert, approval one extra, only real PC/phone viewing rearms FUTURE waits. Persist across restarts; dismissal is not seen.
- Optional remote protocol fields/events; advertise new seen capability; legacy missing metadata must be visible. No remote protocol version bump unless an existing parser contract forces one.
- Worktree is native-managed detached HEAD. Commit task changes locally; do not push/publish. Never revert other work.
- Windows test runner must use `--pool=threads --maxWorkers=2`: uncapped baseline spawned enough processes to exhaust memory. Use only task-specific processes.

## Review Focus

- Late PC/phone acknowledgment must not hide a more recent wait: pin generation ordering in task 2.
- Session navigation must not treat hidden/background content as viewed: pin lifecycle and current-ID checks in task 2.
- Normal-buffer mouse-reporting CLI must scroll its own history: real xterm-mode and drag routing regression in task 1, actual text browser fixture in task 3.
- Same project/path labels must not merge identities: group/model tests in task 1.
- A working transition, disconnected snapshot or Android process restart must not rearm alert sound: durable reducer tests in task 2.

## Task 1: Mobile path navigation and terminal history

**Files:** `src/shared/remote-types.ts`, `src/shared/remote-session-list.ts`, `src/main/remote/remote-session-hub.ts`, `src/main/runtime.ts`; mobile `MobileApp`, `SessionList`, `SessionScreen`, `mobile.css`, touch/model helpers and tests. Create focused drawer/model helpers instead of expanding MobileApp without bounds.

**Interfaces:** Optional `RemoteSessionSummary.cwd`, `.projectRootPath`; workspace updates carry complete session summaries. Optional `attached.scrollback` supplies host setting, fallback `DEFAULT_SETTINGS.terminal.scrollback`. Existing terminal size ownership and remote protocol version stay intact.

- [x] RED: grouping tests for same display names/different IDs, same basename/different full paths, absent fields and worktree paths; UI tests for drawer open/close/select/back with terminal instance preserved; scrolling test normal buffer + mouse tracking must route to wheel despite baseY=0.
- [x] Implement optional metadata forwarding, live workspace updates and host scrollback. Normalize/group paths without lowercasing POSIX paths. Use same state reducer in all TS remote consumers.
- [x] Implement project/path drawer, persisted expansion, active project/path header and full-path disclosure. Use a transient history entry so Android WebView Back closes drawer first; avoid intermediate session remount on selection. Internal drawer scroll, accessible labels/focus handling, 44px controls.
- [x] Route touch to CLI when alternate buffer OR mouse tracking is enabled; normal prompt still uses scrollback. Reuse terminal-output-filter for replay/live, reinitialize it on attach, preserve sequence gate. Keep horizontal gestures and existing phone-size behavior.
- [x] GREEN: run focused remote/mobile/output tests, `npm run typecheck`, then full `npx vitest run --pool=threads --maxWorkers=2`; commit. Report RED/GREEN commands and any unresolved real-device limitation.

## Task 2: Host seen synchronization and Android notification lifecycle

**Files:** shared remote types/reducer; new focused `src/main/remote/mobile-attention-store.ts` and tests; remote hub/runtime integration; mobile app/bridge/viewing helper; Android notify/data/web/SessionActivity classes and JUnit tests.

**Interfaces:** Introduce exported `RemoteAttentionState { generation: number; seenThrough: number }`, optional `.attention` in session summaries/status messages, `welcome.capabilities` advertising `session-seen-v1`, client `{type:'seen', sessionId, generation}`, server `{type:'seen', sessionId, attention}`. New state persists separately in `mobile-attention.json` under host userData. Server validates integer generation and attached existing session; no future/stale acknowledgment may consume new waits. Initial snapshots carry attention but never alert merely by being loaded.

- [x] RED: host transition/seen persistence, stale acknowledgment, duplicate status, restart, removal and serialization/race tests. Generation advances for a DIFFERENT notifiable status (input/approval/end/error) after prior state, including work->wait, but not duplicate same status. Seen-through never exceeds observed generation. Working clears displayed need, never the notification latch.
- [x] Implement store with existing JSON atomic persistence conventions, queue per store operations and preserve ordering. Process status with current desktop visibility/active-presence result before publishing attention; visible waits have seenThrough==generation, preventing alert-then-cancel races. Connect existing actual-PC-view signals with visible/focused/presence guards; do not modify desktop notification rules.
- [x] Add capability-gated mobile seen acknowledgment after attached content is ready, for the exact displayed generation, only when document/native Activity foreground and drawer is not covering content. Extend bridge v2 with current-session reporting and native foreground signal; provide safe feature detection for bridge v1/browser. Cancel/ack only displayed session. New current wait while foreground gets acknowledged; leaving it does not re-alert it.
- [x] RED: Kotlin parsing optional metadata/capabilities/attention, durable per-host/session deduper, first input/approval escalation/approval-first/input-after-approval, repeated working/waiting, stale seen, snapshot/restart, native foreground and two-host isolation. Old host fallback must use local phone seen without pretending PC sync exists.
- [x] Implement durable native reducer and event outputs that distinguish audible post, silent update and cancel. Highest announced severity remains until confirmed seen of the relevant generation; delayed seen cannot cancel newer notification. Removing resolved UI notice does not forget the latch. Suppressed/permission-blocked events must not consume the audible budget. Dismissal does not mark seen. End/error (if enabled) use ordinary input-level budget; approval is the sole escalation.
- [x] Add metadata title/body and expanded full path/branch, preserve deep links. New shell with old host shows a concise update-needed notice for unsupported PC seen sync; path fallback explicit. Preserve existing notification settings and session-specific native suppression.
- [x] GREEN: focused TS/JUnit tests + typecheck + full Vitest. Build debug APK; increment shell versionCode from 3 to 4 and versionName from 0.2.0 to 0.3.0 (source change, no publication). Commit and report tests and limitations.

## Task 3: Integration verification and user-visible review

**Files:** `e2e/mobile.spec.ts`, focused additional browser fixtures if needed, approved design/plan validation notes. Only fix regressions evidenced by tests/review.

- [x] Add browser tests proving old TEXT becomes visible in a CLI-owned normal-buffer mouse fixture and normal scrollback, not only emitted wheel bytes. Cover drawer/back/path metadata and terminal continuity. Keep Windows coverage; do not hide failures by skipping all alternate/mouse tests on Windows.
- [x] Run `npm run build`, full Vitest if new changes justify rerun, `npx playwright test e2e/mobile.spec.ts`, `android\gradlew.bat :app:testDebugUnitTest :app:assembleDebug` with actual installed SDK/JDK. Inspect mobile viewport visually.
- [x] Inspect available adb device; if a usable already connected device exists, use non-destructive checks for actual behavior. Do not claim physical Codex/Claude verification without evidence, nor replace installed signed user app with debug build.
- [x] Request fresh whole-branch review and resolve substantive findings with covering regression tests. Record exact result, commit, and report implementation/build separately from real-device validation and publication.
