# Attention Notifications and Activity Titles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make unseen Codex and Claude Code waits visibly request attention in Windows, and keep Home recent-activity entries synchronized with a session's resolved title.

**Architecture:** A small main-process tracker owns unseen waiting session IDs and derives one attention level. `runtime.ts` applies that level after status and selection changes; `index.ts` renders it through a testable BrowserWindow adapter. Home retains a historical fallback label only for removed sessions and derives its current label from a live session.

**Tech Stack:** Electron 34, TypeScript 5.7, React 18, Vitest 3, Testing Library.

## Global Constraints

- Target Windows 10 1809 or newer; do not add a settings UI or custom sound asset.
- Use shared normalized `awaiting-input` and `awaiting-approval` statuses for Codex and Claude Code.
- Preserve the current Windows toast copy, `silent: false`, deduplication, and click-to-show behavior.
- An actively focused selected session is already seen and produces no taskbar/title cue.
- `awaiting-approval` takes precedence over `awaiting-input` when both are unseen.
- Preserve uncommitted `src/renderer/src/ProjectDetailPage.tsx` and `src/renderer/src/index.css` changes.

---

### Task 1: Track unseen terminal attention states

**Files:**
- Create: `src/main/attention-policy.ts`
- Create: `src/main/attention-policy.test.ts`

**Interfaces:**
- Consumes: `TerminalStatus` from `src/shared/terminal-types.ts`.
- Produces: `WindowAttention = "none" | "input" | "approval"` and `createTerminalAttentionTracker()`.
- The tracker exposes `applyStatus(sessionId: string, status: TerminalStatus): WindowAttention` and `markSeen(sessionId: string | null): WindowAttention`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createTerminalAttentionTracker } from "./attention-policy";

describe("terminal attention tracker", () => {
  it("keeps an unseen wait visible until its session is seen or resumes", () => {
    const tracker = createTerminalAttentionTracker();
    expect(tracker.applyStatus("codex-1", "awaiting-input")).toBe("input");
    expect(tracker.markSeen("claude-1")).toBe("input");
    expect(tracker.markSeen("codex-1")).toBe("none");
    expect(tracker.applyStatus("codex-1", "awaiting-input")).toBe("input");
    expect(tracker.applyStatus("codex-1", "working")).toBe("none");
  });

  it("gives an unseen approval precedence over input from another session", () => {
    const tracker = createTerminalAttentionTracker();
    tracker.applyStatus("codex-1", "awaiting-input");
    expect(tracker.applyStatus("claude-1", "awaiting-approval")).toBe("approval");
    expect(tracker.markSeen("claude-1")).toBe("input");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/main/attention-policy.test.ts`

Expected: FAIL because `./attention-policy` does not exist.

- [ ] **Step 3: Write the minimal implementation**

```ts
import type { TerminalStatus } from "../shared/terminal-types";

export type WindowAttention = "none" | "input" | "approval";

export interface TerminalAttentionTracker {
  applyStatus(sessionId: string, status: TerminalStatus): WindowAttention;
  markSeen(sessionId: string | null): WindowAttention;
}

export function createTerminalAttentionTracker(): TerminalAttentionTracker {
  const unseen = new Map<string, WindowAttention>();
  const current = (): WindowAttention =>
    [...unseen.values()].includes("approval") ? "approval" : unseen.size > 0 ? "input" : "none";
  return {
    applyStatus(sessionId, status) {
      if (status === "awaiting-approval") unseen.set(sessionId, "approval");
      else if (status === "awaiting-input") unseen.set(sessionId, "input");
      else unseen.delete(sessionId);
      return current();
    },
    markSeen(sessionId) {
      if (sessionId) unseen.delete(sessionId);
      return current();
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/main/attention-policy.test.ts src/main/notification-policy.test.ts`

Expected: PASS with all tracker and notification-policy assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/main/attention-policy.ts src/main/attention-policy.test.ts
git commit -m "feat: track unseen terminal attention"
```

### Task 2: Present attention in the Windows title and taskbar

**Files:**
- Create: `src/main/window-attention.ts`
- Create: `src/main/window-attention.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/runtime.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/main/ipc.test.ts`

**Interfaces:**
- Consumes: `WindowAttention` and `createTerminalAttentionTracker` from `src/main/attention-policy.ts`.
- Produces: `applyWindowAttention(window, attention)` that calls `setTitle()` and `flashFrame()` on a live BrowserWindow-like object.
- `createDesktopRuntime(showMainWindow, installUpdate, applyAttention)` accepts optional `(attention: WindowAttention) => void`.
- `registerMainIpc` accepts optional `onSessionSelected(sessionId: string | null): void` and invokes it after `coordinator.select` persists selection.

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, it, vi } from "vitest";
import { applyWindowAttention } from "./window-attention";

it("prefixes the title and flashes until no unseen wait remains", () => {
  const window = { isDestroyed: () => false, setTitle: vi.fn(), flashFrame: vi.fn() };
  applyWindowAttention(window, "approval");
  applyWindowAttention(window, "none");
  expect(window.setTitle).toHaveBeenNthCalledWith(1, "! 멀티 터미널 작업기");
  expect(window.flashFrame).toHaveBeenNthCalledWith(1, true);
  expect(window.setTitle).toHaveBeenLastCalledWith("멀티 터미널 작업기");
  expect(window.flashFrame).toHaveBeenLastCalledWith(false);
});
```

```ts
it("marks a selected terminal seen after persisting selection", async () => {
  const { handlers, onSessionSelected } = setup({ onSessionSelected: vi.fn() });
  await handlers.get("terminals:select")!({}, "project-1", "session-1");
  expect(onSessionSelected).toHaveBeenCalledWith("session-1");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/main/window-attention.test.ts src/main/ipc.test.ts`

Expected: FAIL because the window adapter and selection callback do not yet exist.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/main/window-attention.ts
import type { WindowAttention } from "./attention-policy";

export const APP_WINDOW_TITLE = "멀티 터미널 작업기";
export interface AttentionWindow {
  isDestroyed(): boolean;
  setTitle(title: string): void;
  flashFrame(flag: boolean): void;
}
export function applyWindowAttention(window: AttentionWindow, attention: WindowAttention): void {
  if (window.isDestroyed()) return;
  const prefix = attention === "approval" ? "! " : attention === "input" ? "● " : "";
  window.setTitle(`${prefix}${APP_WINDOW_TITLE}`);
  window.flashFrame(attention !== "none");
}
```

```ts
// runtime.ts: clear a session immediately on every non-wait status
if (event.status !== "awaiting-input" && event.status !== "awaiting-approval") {
  applyAttention(attentionTracker.applyStatus(event.sessionId, event.status));
  return;
}

// runtime.ts: after reading current selection and window visibility
const sessionIsActivelyVisible = !shouldShowTerminalStatusNotification({
  eventSessionId: event.sessionId, selectedSessionId, windowVisible, windowFocused,
});
if (sessionIsActivelyVisible) applyAttention(attentionTracker.markSeen(event.sessionId));
else applyAttention(attentionTracker.applyStatus(event.sessionId, event.status));

// ipc.ts: terminals:select after await coordinator.select(...)
dependencies.onSessionSelected?.(sessionId);
return snapshot;

// runtime.ts injected IPC dependency
onSessionSelected: (sessionId) => applyAttention(attentionTracker.markSeen(sessionId)),
```

In `index.ts`, retain the latest attention state in module scope, call `applyWindowAttention(mainWindow, attention)` whenever runtime invokes the callback, and apply that retained state in `createWindow()` so a recreated window reflects an existing unseen wait.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm test -- src/main/attention-policy.test.ts src/main/window-attention.test.ts src/main/ipc.test.ts && npm run typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/attention-policy.ts src/main/attention-policy.test.ts src/main/window-attention.ts src/main/window-attention.test.ts src/main/index.ts src/main/runtime.ts src/main/ipc.ts src/main/ipc.test.ts
git commit -m "feat: surface waiting sessions in the taskbar"
```

### Task 3: Resolve Home activity labels from live sessions

**Files:**
- Modify: `src/renderer/src/HomeDashboard.tsx`
- Modify: `src/renderer/src/HomeDashboard.test.tsx`

**Interfaces:**
- Consumes: `ActivityEntry.sessionId`, stored `ActivityEntry.sessionLabel`, and live `TerminalSessionView[]` props.
- Produces: each activity row uses `sessionLabel(liveSession, peers)` while its session exists; otherwise it displays `entry.sessionLabel`.

- [ ] **Step 1: Write the failing test**

```tsx
it("uses a provider title that arrived after the activity entry was recorded", () => {
  installUpdatesApi();
  const session = makeSession({ id: "codex-1", kind: "codex", title: "알림 정책 구현" });
  const activityLog: ActivityEntry[] = [{
    id: "entry-1", timestamp: "2026-07-11T00:00:00.000Z", projectId: atlas.id,
    sessionId: session.id, sessionLabel: "Codex", fromStatus: "working", toStatus: "awaiting-input",
  }];
  render(<HomeDashboard {...baseProps()} sessions={[session]} activityLog={activityLog} />);
  expect(within(screen.getByRole("region", { name: "최근 활동" })).getByText("알림 정책 구현")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/renderer/src/HomeDashboard.test.tsx`

Expected: FAIL because the activity row renders captured `entry.sessionLabel`, `Codex`.

- [ ] **Step 3: Write the minimal implementation**

```tsx
const session = sessions.find((candidate) => candidate.id === entry.sessionId);
const label = session
  ? sessionLabel(session, sessions.filter((candidate) => candidate.projectId === session.projectId))
  : entry.sessionLabel;

<span className="activity-name">{label}</span>
```

Keep the stored label as fallback for activity belonging to a removed session.

- [ ] **Step 4: Run the renderer tests to verify it passes**

Run: `npm test -- src/renderer/src/HomeDashboard.test.tsx src/renderer/src/App.test.tsx`

Expected: PASS, including the late-title activity-label assertion.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/HomeDashboard.tsx src/renderer/src/HomeDashboard.test.tsx
git commit -m "fix: refresh recent activity session titles"
```

### Task 4: Full verification and manual desktop smoke check

**Files:**
- Modify: `README.md`

**Interfaces:**
- Documents that unseen input and approval waits keep a taskbar/title marker until selection or resumed work.

- [ ] **Step 1: Update the notification feature description**

```md
- **알림은 놓치지 않게** — 화면에 없는 세션이 입력 대기나 승인 대기에 들어가면 Windows 알림과 작업표시줄 깜빡임이 함께 켜지고 창 제목 앞에 표시가 남는다. 해당 세션을 열거나 작업이 재개되면 해제된다.
```

- [ ] **Step 2: Run complete automated verification**

Run: `npm test && npm run typecheck && npm run build`

Expected: all Vitest tests pass, both TypeScript projects typecheck, and electron-vite writes the production bundle to `out/`.

- [ ] **Step 3: Manually smoke-test both providers in Electron**

Run: `npm run dev`

Expected: with the window hidden or another session selected, Codex turn-complete and Claude Stop/Notification each show the toast, flash the taskbar, and prefix the title. Selecting one waiting session stops flashing only when no other unseen wait remains. The Home activity label updates after its provider title arrives.

- [ ] **Step 4: Commit docs and verification result**

```bash
git add README.md docs/superpowers/plans/2026-07-12-attention-notifications-and-activity-titles.md
git commit -m "docs: describe terminal attention signals"
```
