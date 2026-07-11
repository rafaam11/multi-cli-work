# Multi CLI Work

Local Windows desktop workspace for running Codex, Claude Code, and PowerShell sessions by project.

## Requirements

- Windows 10 version 1809 or newer
- Node.js 20 or newer for development
- Windows PowerShell 5.1 or PowerShell 7
- Optional `claude` and `codex` executables on `PATH`

## Development

```powershell
npm install
npm run dev
```

```powershell
npm test
npm run typecheck
npm run test:e2e
npm run dist
```

`npm run test:e2e` builds the app and exercises a real PowerShell ConPTY session through Electron. The NSIS installer and unpacked application are written to `release/`.

## Local Data

- Shared projects: `~/.harness-manager/projects.json`
- Window, tab, and resume state: Electron `userData/state.json`
- Bounded terminal replay logs: Electron `userData/session-logs/`
- App-owned Claude hook overlay: Electron `userData/hooks/` and `claude-settings.json`

Closing the window hides the app to the system tray and keeps managed PTYs alive. Explicit Quit stops those PTYs. Saved AI sessions are resumed only through the visible Resume action.

The approved architecture and implementation plan are in [`docs/superpowers/specs/2026-07-11-multi-cli-work-design.md`](docs/superpowers/specs/2026-07-11-multi-cli-work-design.md) and [`docs/superpowers/plans/2026-07-11-multi-cli-work.md`](docs/superpowers/plans/2026-07-11-multi-cli-work.md).
