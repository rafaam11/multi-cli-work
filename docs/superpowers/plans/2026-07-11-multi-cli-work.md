# Multi CLI Work MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans and implement each task test-first.

**Goal:** Build and package a local Windows desktop app that manages Codex, Claude Code, and PowerShell terminal sessions by a project model shared with Harness Manager.

**Architecture:** Electron main owns desktop lifecycle and the shared registry, a utility process owns ConPTY sessions, and a sandboxed React renderer presents the tree and xterm.js terminal. Harness Manager and Multi CLI Work share only a versioned project registry.

**Tech Stack:** Electron 34, React 18, TypeScript 5.7, Vite 6, electron-vite 3, node-pty 1.1, xterm.js 6, Vitest 3, Playwright, electron-builder.

## Global Constraints

- Target Windows 10 1809 or newer and one local user.
- Product name is `Multi CLI Work`; package name is `multi-cli-work`; app ID is `com.rafaam11.multicliwork`.
- AI providers are exactly `claude` and `codex`; the only general shell is PowerShell.
- Renderer remains sandboxed with context isolation and cannot submit arbitrary executables or cwd values.
- Shared project state lives at `~/.harness-manager/projects.json`; terminal state never enters that file.
- Preserve the existing dirty Harness Manager worktree and implement its changes in an isolated worktree.

---

### Task 1: Repository and Electron shell

- Initialize `main` with docs, create `feat/mvp`, scaffold electron-vite/React/TypeScript, add scripts and test configuration, and render the application shell.
- Verify typecheck, unit test, and production build before committing.

### Task 2: Shared project registry and Harness Manager migration

- Define the v1 registry types and validator, path reconciliation, cross-process lock/read-merge-write behavior, backups, corruption handling, and tests.
- In an isolated Harness Manager worktree, add the same contract and migrate project board entries while leaving plan/session board data intact.
- Verify concurrent writer integration tests and the full Harness Manager test/build loop before committing each repository independently.

### Task 3: PTY utility process and typed IPC

- Define terminal session/request/event contracts first in tests.
- Implement the utility-process PTY manager, bounded replay buffer, write/resize/stop/attach, crash handling, and the allowlisted preload bridge.
- Verify with a PowerShell fixture that emits ANSI, OSC 9, large output, and controlled exits.

### Task 4: Project tree and terminal workspace

- Build the resizable project tree, nested provider sessions, terminal header, new-session menu, empty/error/missing-path states, and xterm.js viewport.
- Connect project and terminal IPC, keyboard focus, copy/paste, resize throttling, and selection persistence.
- Verify renderer tests and Playwright screenshots at desktop and compact window sizes.

### Task 5: Provider lifecycle, tray, notifications, and recovery

- Add PowerShell, Claude, and Codex command/resume adapters with Windows quoting tests.
- Implement the unified status state machine, Claude overlay hooks, Codex OSC events, background wait notifications, tray behavior, state persistence, capped logs, and explicit Resume.
- Verify real CLI smoke tests without modifying global provider settings.

### Task 6: Installer and final verification

- Configure electron-builder NSIS metadata and native dependency rebuilds.
- Run the complete unit, integration, Electron E2E, production build, and installer verification loops.
- Install, launch, exercise tray behavior, quit, relaunch, and uninstall the unsigned local MVP package.

