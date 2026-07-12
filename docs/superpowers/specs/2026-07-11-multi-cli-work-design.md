# Multi CLI Work MVP Design

## Product

Multi CLI Work is a local-only Windows desktop app for one user. Its left sidebar shows a shared project tree, with multiple Codex, Claude Code, or PowerShell sessions nested under each project. The right side shows one focused terminal at a time.

Projects are discovered from local Claude and Codex history and can also be added manually. Project identity and manual metadata are shared with Harness Manager. Terminal processes, window state, tabs, and scrollback remain private to Multi CLI Work.

The unified session states are `starting`, `working`, `awaiting-input`, `awaiting-approval`, `idle`, `exited`, and `error`. Windows notifications fire only when an unfocused session enters an input or approval wait state.

Closing the window hides the app to the tray and keeps PTYs alive. Explicit Quit confirms and terminates active PTYs. After a full restart, project and tab state plus bounded scrollback are restored, while AI sessions require an explicit Resume action.

## Architecture

- Electron main owns windows, tray, notifications, app lifecycle, and the project registry.
- An Electron utility process owns every `node-pty` process and a bounded output ring buffer.
- A sandboxed React renderer owns the project tree and xterm.js terminal presentation.
- A typed preload bridge is the only renderer access to projects and terminals.

The shared project registry is `~/.harness-manager/projects.json`. It uses stable UUIDs, normalized path matching, a versioned runtime-validated schema, cross-process lockfile coordination, backup, and atomic replacement. Harness Manager retains plan and session board data in its existing `board.json`; only project identity and project metadata move to the shared registry.

Provider adapters own command construction, lifecycle signals, and resume behavior. PowerShell prefers `pwsh.exe` and falls back to `powershell.exe`. Claude uses an app-owned settings overlay and a preallocated session UUID. Codex remains its native TUI and uses OSC notifications plus process and input signals; uncertain Codex activity is shown as `idle`, never as a false approval state.

## MVP Boundaries

Included: project discovery/manual add, nested multi-session tree, one terminal viewport, tray persistence, notifications, manual resume, local NSIS installer. Completeness pass additions: manual project refresh, project metadata editing (display name/status/memo/hidden) with a hidden-projects toggle, registry restore-from-backup, per-session notification dedupe, and the shared registry contract in `registry-contract.md`.

Excluded: split panes, WSL, arbitrary shell profiles, file browsing, Git UI, cloud sync, automatic updates, Codex App Server integration, and public release publishing.

## Acceptance

The registry must survive concurrent writes from both apps, migration from Harness Manager board data, missing paths, malformed input, and lock timeout without data loss. Terminal tests must cover ANSI/OSC handling, resize, high-volume output, exit codes, worker failure, and state transitions. Electron tests must cover project/session workflows, tray behavior, notification routing, restart restoration, production build, and NSIS installation.

