# Multi CLI Work

Local Windows desktop workspace for running Codex, Claude Code, and PowerShell sessions by project.

## Install

Download `Multi-CLI-Work-Setup-x.y.z.exe` from the [latest release](https://github.com/rafaam11/multi-cli-work/releases/latest) and run it. The installer is per-user, so it needs no administrator rights. It is not code-signed: SmartScreen shows "Windows protected your PC" on first run, and the installer starts from **More info → Run anyway**.

## Updates

A packaged app checks GitHub Releases on startup, downloads a new version in the background, and the sidebar badge switches to **Restart** when it is ready. Restarting from that badge stops the managed PTYs first, then installs silently and reopens the app. An update that is downloaded but not applied installs on the next explicit Quit. The badge (and the tray's **Check for Updates**) also checks on demand; if a check fails, the badge links to the releases page for a manual install. Development builds have no update feed and always report "Up to date".

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

## Release

Bump `version` in `package.json`, commit it as `chore: release vX.Y.Z`, then push the matching tag:

```powershell
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

The `v*` tag triggers `.github/workflows/release.yml`, which builds on `windows-latest` and publishes the installer, `latest.yml`, and its blockmap to a **draft** GitHub release. Review the draft and publish it manually — `latest.yml` is what running installs read to discover the new version, so a release without it will not reach existing users. `appId` (`com.rafaam11.multicliwork`) must never change: the updater identifies the installed app by it.

## Local Data

- Shared projects: `~/.harness-manager/projects.json` — contract with Harness Manager documented in [`docs/superpowers/specs/registry-contract.md`](docs/superpowers/specs/registry-contract.md)
- Window, tab, and resume state: Electron `userData/state.json`
- Bounded terminal replay logs: Electron `userData/session-logs/`
- App-owned Claude hook overlay: Electron `userData/hooks/` and `claude-settings.json`

Closing the window hides the app to the system tray and keeps managed PTYs alive. Explicit Quit stops those PTYs. Saved AI sessions are resumed only through the visible Resume action.

The sidebar can refresh discovered projects on demand, edit project metadata (display name, status, memo, hidden) shared with Harness Manager, reveal hidden projects, and restore the shared registry from its backup when the primary file is corrupted.

The approved architecture and implementation plan are in [`docs/superpowers/specs/2026-07-11-multi-cli-work-design.md`](docs/superpowers/specs/2026-07-11-multi-cli-work-design.md) and [`docs/superpowers/plans/2026-07-11-multi-cli-work.md`](docs/superpowers/plans/2026-07-11-multi-cli-work.md).
