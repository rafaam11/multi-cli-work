# Attention notifications design

## Goal

Make a Codex or Claude Code session that needs the user's attention difficult to miss without creating repeat alerts. The app must use the same behavior for both providers because both already converge on the shared `awaiting-input` and `awaiting-approval` statuses.

## Considered approaches

1. **Windows toast only**: smallest change, but easy to miss when notifications are muted or dismissed.
2. **Taskbar-only attention**: highly visible while working in another app, but gives no persistent explanation for why the app needs attention.
3. **Layered attention signals (selected)**: retain the toast sound, flash the taskbar button, and prefix the window title with an attention indicator. This is noticeable yet self-clearing, and does not add another settings surface.

## User experience

- A background Codex or Claude session enters `awaiting-input` or `awaiting-approval`.
- The existing Windows toast is shown with its normal sound.
- The application flashes in the taskbar and its title becomes `● 멀티 터미널 작업기` for input, or `! 멀티 터미널 작업기` when approval is required. Approval wins when both wait states are present.
- The attention marker and flashing remain while any unseen session needs attention.
- Selecting a waiting session marks it seen. If no other unseen waiting session remains, the normal title and non-flashing taskbar state are restored.
- Status changes back to `working`, `idle`, `exited`, or `error` remove that session from the attention set. Closing or hiding the window must not incorrectly clear a still-unseen waiting session.
- The behavior is provider-neutral: Codex OSC events and Claude hook events are already normalized before this policy runs.

## Architecture

Create a small main-process attention-state policy that owns the set of sessions currently requesting attention and derives the title prefix. `runtime.ts` will send its status events into that policy, then call Electron's `BrowserWindow.setTitle()` and `BrowserWindow.flashFrame()` through a narrow window-attention adapter owned by `index.ts`.

The existing notification deduper remains responsible only for repeated Windows toast suppression. The attention state deliberately does not depend on whether Windows supports native notifications, so taskbar/title cues still work when toast notifications are unavailable or disabled.

`showMainWindow` and the renderer's existing selected-session state are used only to mark a particular session seen; they must not clear attention for unrelated sessions.

## Error handling

- If the main window has not been created, retain state but defer title/taskbar updates until it exists.
- If a window is destroyed, ignore its update; recreating the window immediately applies the derived attention state.
- Electron APIs are best-effort only; a failure to flash or retitle must not interrupt PTY lifecycle or status event delivery.

## Verification

- Unit-test the attention policy: add, clear, see one of several sessions, and approval precedence.
- Unit-test the runtime/window adapter wiring with a fake `BrowserWindow`, including the reset path.
- Run the existing unit suite and TypeScript check.
- Manually verify a background Codex and Claude session both cause taskbar/title attention and that opening each session clears only its own marker.

## Scope boundaries

No per-provider behavior, new settings screen, custom audio files, or changes to CLI launch flags are included. The current toast wording and click-to-show-window behavior remain unchanged.
