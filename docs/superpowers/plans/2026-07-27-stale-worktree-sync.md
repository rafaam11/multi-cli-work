# Stale Worktree Sync Implementation Plan

> **완료:** 코드·테스트는 커밋 6a3ec45로 구현되었다(`worktree-service.ts` sync 내 sessionless
> stale 항목 제거). Step 6의 사용자 데이터 정리는 해당 PC(`C:\Users\uiop3`)에서만 확인
> 가능하므로 이 문서에서는 미검증으로 남긴다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove sessionless worktree registry entries automatically when Git no longer reports them.

**Architecture:** `WorktreeService.performSync()` remains the single reconciliation boundary between Git and `worktrees.json`. An unseen registry entry is retained as a `missing` workspace only while `hasWorktreeSessions(id)` is true; otherwise the same sync transaction deletes it and omits it from the returned snapshot.

**Tech Stack:** TypeScript, Node.js child processes and filesystem APIs, Vitest with a real temporary Git repository.

## Global Constraints

- Never remove a stale registry entry while a persisted terminal session references its worktree ID.
- Do not change Git-reported worktrees, project roots, renderer filtering, or IPC contracts.
- Do not mutate a project's registry entries when Git discovery for that project fails.
- Restrict user-data cleanup to `codex/cockpit-install-621` after confirming Git and session state again.

---

### Task 1: Reconcile stale registry entries during sync

**Files:**
- Modify: `src/main/projects/worktree-service.test.ts`
- Modify: `src/main/projects/worktree-service.ts`

**Interfaces:**
- Consumes: `WorktreeServiceOptions.hasWorktreeSessions(worktreeId): boolean | Promise<boolean>` and `listGitWorktrees(project.rootPath)`.
- Produces: `WorktreeService.sync(projects): Promise<WorktreeWorkspaceSnapshot>` that omits and deletes unseen sessionless entries while retaining unseen session-backed entries as `availability: "missing"`.

- [x] **Step 1: Write the failing sessionless reconciliation test**

```ts
it("removes stale registry entries without sessions during sync", async () => {
  const { service: worktrees } = service();
  const created = await worktrees.create("project-1", "feature-stale-sessionless");
  await git(repoRoot, "worktree", "remove", created.path);

  const snapshot = await worktrees.sync([project()]);

  expect(snapshot.workspaces.some((workspace) => workspace.worktreeId === created.id)).toBe(false);
  expect((await readWorktreeRegistry({ registryPath })).worktrees[created.id]).toBeUndefined();
});
```

- [x] **Step 2: Extend the session-backed test to cover sync output**

Add a real `sync([project()])` before explicit cleanup and assert both registry preservation and the returned missing workspace:

```ts
const snapshot = await worktrees.sync([project()]);
expect(snapshot.workspaces.find((workspace) => workspace.worktreeId === created.id)).toMatchObject({
  availability: "missing",
  prunableReason: "Git no longer reports this worktree",
});
expect((await readWorktreeRegistry({ registryPath })).worktrees[created.id]).toBeDefined();
```

- [x] **Step 3: Run the focused test and verify the expected failure**

Run: `npm test -- src/main/projects/worktree-service.test.ts`

Expected: the new sessionless test fails because `sync()` still returns the missing workspace and leaves its registry entry intact; the session-backed assertion passes.

- [x] **Step 4: Implement minimal reconciliation in `performSync()`**

Before constructing a missing workspace, remove the unseen entry if it owns no sessions:

```ts
if (!(await this.options.hasWorktreeSessions?.(entry.id))) {
  delete entries[entry.id];
  changed = true;
  continue;
}
```

Keep the existing missing-workspace construction unchanged for session-backed entries. The existing `changed` write at the end persists additions and removals atomically through `replaceWorktreeEntries()`.

- [x] **Step 5: Run focused and complete verification**

Run:

```powershell
npm test -- src/main/projects/worktree-service.test.ts
npm test
npm run typecheck
npm run build
```

Expected: all commands exit 0 with no failed tests or TypeScript errors.

- [ ] **Step 6: Clean the confirmed stale user entry**

Re-run `git -C C:\Users\uiop3\Desktop\0_LLMwiki_ws worktree list --porcelain` and inspect `%APPDATA%\multi-cli-work\state.json` for the target worktree ID. If Git still reports only main and no session references `14df5300-9705-4a3c-8dc3-2531360789ae`, remove only that entry from `C:\Users\uiop3\.multi-cli-work\worktrees.json` while preserving the store schema and timestamps.

- [x] **Step 7: Package and commit**

Run `npm run dist:win`, then stage only:

```powershell
git add -- src/main/projects/worktree-service.ts src/main/projects/worktree-service.test.ts docs/superpowers/plans/2026-07-27-stale-worktree-sync.md
git commit -m "fix: reconcile stale worktree registry entries"
```

Verify the installer exists at `release/Multi-CLI-Work-Setup-1.8.0.exe`. Do not launch the installer while it hosts the active Codex session.
