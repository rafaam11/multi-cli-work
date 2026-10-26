# Mobile context, history and notification design

Approved in the planning interview on 2026-10-26; user requested implementation.

## User decisions

- Keep horizontal session tabs. Add a left overlay drawer grouped project -> actual working path -> session. Selecting a session/backdrop closes it. Groups can collapse.
- Show current project and shortened path even when the drawer is closed; reveal the full path on tap. Drawer width min(86vw, 320px), default closed. Preserve terminal attachment, PTY size and reading position when toggling it. Android Back closes the drawer before existing session navigation.
- Retain existing terminal UI; fix access to earlier output, not a new transcript reader. Symptoms: scrolling works but older conversation is absent; provider/timing uncertain. Verify actual historical text, not just scrolling inputs.
- Input waits audibly notify once until that session is actually viewed. An approval may escalate with one additional audible alert; subsequent input/approval flapping updates silently until viewed. Either phone or PC viewing counts. Dismissing an OS notification does not.
- Remove a waiting notification when work resumes, but retain the deduplication latch. Repeated waits may silently recreate it. Confirming the currently shown wait must not re-alert that same wait when leaving the screen.
- Rich notifications contain project, session, host, cwd, agent, reason and optional branch, with existing session deep link. No conversation snippets.

## Boundaries and defaults

- Project identity uses projectId, never projectName. Path identity uses host-provided absolute cwd with platform-aware normalization. Null project/path has an explicit unavailable label; no guessed metadata.
- Waiting sessions remain in their project/path group with badges, not moved out into a separate group. Preserve host session order inside groups. Persist expanded group state per host.
- Forward live workspace metadata changes. Optional protocol additions preserve older clients/hosts. Existing wide desktop-remote layout behavior remains compatible.
- Mobile scrollback follows host terminal setting (default 10,000); retain the existing bounded raw-log storage. Touch wheel routing must recognize mouse tracking in a normal buffer as well as alternate screen. Share existing desktop output filtering, with fresh filter on replay reset. Do not alter original PTY output/log files.
- Confirmed preimplementation gap: normal buffer + vt200 mouse tracking + no normal scrollback causes the current mobile touch planner to emit zero lines. The existing desktop synchronized-output filter is absent mobile; a headless fixture did not reproduce its viewport bug, so it is a parity change, not proof of the user's full root cause.
- Notification state must survive reconnection/app restart. Host owns monotonically increasing wait generations and seen-through generation; a stale acknowledgment cannot consume a newer wait. Reconnection snapshots reconcile PC viewing while phone was offline, without announcing an initial backlog.
- Only actual foreground session display counts as seen, not sidebar/list browsing, automatic/background attachment or a merely open idle PC window. Mobile native lifecycle participates. PC confirmation uses actual visible/focused active session(s), independently of existing desktop alert policy.
- Preserve notification enable/mute/skip-when-at-PC/include-ended preferences. End/error default remains off and when enabled obeys the same notification budget. Native suppression targets the displayed session, not every session on that host.
- Existing repository changes are not reverted. No publishing/pushing/deployment is requested. Host and Android APK both need updates to obtain all features; old versions degrade explicitly and remain usable.

## Acceptance

- Project-name/path collisions, worktrees and running cwd changes remain unambiguous.
- Drawer opening/closing does not attach/detach/reset/resize the terminal. Back, tab selection and deep linking stay correct.
- Historical text is readable in normal output and CLI-owned scrolling, host/phone dimensions, reconnect and tab re-entry. Real Windows+Android Codex/Claude checks remain distinct from synthetic/browser verification.
- Notification tests cover first input, one approval escalation, flapping, working transitions, silent updates, dismissal, foreground state, PC/phone seen, late acknowledgments, disconnect/restart, removal, host isolation and old/new compatibility.
- Full TypeScript checks/build, focused and full test suite, mobile browser E2E, Kotlin tests and Android APK build. Unavailable physical-device checks are reported, never represented as completed.
