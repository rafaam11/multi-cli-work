# Session Workspace Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the expanded sidebar's duplicated Workspace shelf and bottom Session panel with one top Session panel that displays and controls the Workspace shelf.

**Architecture:** Keep `App` as the single owner of shelf slot order and persistence. `ProjectSidebar` derives the Session panel's ordered items from the active shelf IDs, routes row selection and drag/drop through the existing shelf callbacks, and retains the Hidden shelf as a separate row. `SessionPanel` keeps its current visual language, scope controls, wait badge, status metadata, and rename/context-menu behavior while accepting workspace selection and move callbacks.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, Playwright, Electron Vite

**Spec:** User-approved conversation design on 2026-09-02: the Session UI replaces Workspace, sits at the top, and behaves like the previous Workspace shelf.

## Global Constraints

- Preserve active/hidden shelf ownership and slot order through the existing `setSlotViews` flow.
- Keep the `대기 N`, status, `전체`, and `여기` UI.
- Hidden panes must not appear in the Session panel.
- Keep the collapsed sidebar rail behavior unchanged.

---

### Task 1: Lock the workspace behavior with a regression test

**Files:**
- Modify: `src/renderer/src/App.test.tsx`

**Interfaces:**
- Consumes: the existing `createApi`, `App`, and shelf persistence harness.
- Produces: a regression contract for placement, filtering, selection, and hiding.

- [x] **Step 1: Write the failing test**

Add a test that asserts the Session panel precedes the Project navigation, the old expanded Workspace row is absent, hidden panes are excluded, clicking the Session heading opens the active shelf, and clicking a row reveals that pane in the active shelf.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- src/renderer/src/App.test.tsx -t "작업공간 선반을 대체"`

Expected: FAIL because the Session panel is still below the project tree and still uses all panes.

- [x] **Step 3: Implement minimal behavior**

Change `ProjectSidebar` and `SessionPanel` so the panel consumes only active-shelf pane IDs, calls `onSelectShelf("active")` from its heading, calls `onSelectShelfPane("active", paneId)` from rows, and sends the secondary row action to `onMovePaneToOtherShelf("active", paneId)`.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- src/renderer/src/App.test.tsx -t "작업공간 선반을 대체"`

Expected: PASS.

### Task 2: Preserve reorder and visual hierarchy

**Files:**
- Modify: `src/renderer/src/ProjectSidebar.tsx`
- Modify: `src/renderer/src/SessionPanel.tsx`
- Modify: `src/renderer/src/index.css`
- Test: `src/renderer/src/App.test.tsx`

**Interfaces:**
- Consumes: `shelfDropProps`, `shelfPaneDropProps`, `onPlacePaneOnShelf`, and persisted Session panel state.
- Produces: a top-mounted panel whose rows reorder the active shelf and a separate Hidden shelf row.

- [x] **Step 1: Write the failing test**

Add an active-shelf drag/drop assertion that verifies the persisted slot order changes when one Session-panel row is dropped beside another.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- src/renderer/src/App.test.tsx -t "세션 패널에서 작업공간 순서를 바꾼다"`

Expected: FAIL because Session-panel rows do not yet expose shelf row drop targets.

- [x] **Step 3: Write minimal implementation**

Pass the existing shelf drop props into the Session panel, render the active Session panel before the Hidden shelf, remove the old bottom placement, and adjust CSS so the panel/list use the upper shelf area without stretching or duplicating borders.

- [x] **Step 4: Run targeted and full verification**

Run: `npm test -- src/renderer/src/App.test.tsx`

Run: `npm run typecheck`

Run: `npm run build`

Expected: all commands exit 0.
