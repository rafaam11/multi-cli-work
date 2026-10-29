# Sidebar simplification and records integration

Approved in conversation on 2026-10-29. Ship as v1.55.1 after verification.

## Contract

- Remove session search, CLI filters and pin controls; retain all/waiting and Ctrl+P.
- Collapsible folder favorites, default expanded, persist in existing sidebar preferences.
- Right sidebar: files, git, records. Records are read-only, scoped to the selected folder and its worktrees, not the parent work project.
- Messages newest first; conditional collapsed held/failed delivery summary; selected-session activity collapsed by default. One main records scroller. No folder means a selection hint.
- Prompt library and delivery editing remain available as command-palette dialogs. Keep stores, drafts, agent board/MCP functions and existing delivery protection.
- Record prompt sends exactly once; preserve original board text and per-recipient edited text. Store target project on delivery records, distinguish unavailable historical held status from live queue state.
- Legacy saved tabs board/deliveries/activity map to records, prompts to files. Keep legacy pins inert and readable.

## Tasks

1. Integrate origin/main with local mobile commits, establish a passing baseline.
2. Simplify left sidebar and add persisted favorites disclosure.
3. Add delivery scope/text snapshots, prompt recording, saved-view compatibility.
4. Integrate records, activity disclosure, auxiliary dialogs and command routes.
5. Verify domain/component regressions, full Vitest/typecheck/build, Electron E2E and visual layouts at 1280x720 and 1366x768/minimum sidebar width. Validate hook flows using isolated fixture profiles; distinguish fixture validation from live account calls.
6. Fresh whole-branch review; fix material findings. Package Windows and verify packaged smoke, release v1.55.1, verify CI/public assets/update manifests.

## Defaults and preservation

Favorites start expanded. Record detail disclosures start collapsed. The records badge counts unread messages in the selected folder. Detailed activity only queries while visible/expanded. Queue durability and retention are unchanged. Old records without text snapshots do not claim an exact historical delivered text. Failed reads are errors, not empty states. Folder switches ignore stale responses. Preserve running session IDs/PIDs when switching tabs and applying saved views.
