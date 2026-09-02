import type { AgentView } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { SharedWorktree } from "@shared/worktree-types";
import { describe, expect, it } from "vitest";
import type { DocumentPane } from "./pane-items";
import { buildSessionPanelItems, matchesScope, sessionPanelWaitCount, sessionRank } from "./session-panel";

function agent(id: string, label: string): AgentView {
  return {
    id, label, commands: [id], args: [], newSessionArgs: [], resumeArgs: [], conversationId: "none",
    statusAdapter: "signals", titleSource: "none", shiftEnter: "enter", icon: id, accentColor: null,
    builtin: true, available: true,
  };
}
const agents = [agent("powershell", "PowerShell"), agent("claude", "Claude Code")];

const atlas: SharedProject = {
  id: "project-atlas", rootPath: "C:\\work\\atlas", displayName: "Atlas", sources: ["manual"],
  providerRefs: { claude: [], codex: [] }, status: null, memo: "", tracks: [], hidden: false, order: 0,
  createdAt: "2026-07-11T00:00:00.000Z", updatedAt: "2026-07-11T00:00:00.000Z",
};
const dashboard: SharedProject = { ...atlas, id: "project-dashboard", rootPath: "C:\\work\\dashboard", displayName: "Dashboard", order: 1 };
const worktree: SharedWorktree = {
  id: "worktree-1", projectId: atlas.id, path: "C:\\work\\atlas-wt\\feature-x", branch: "feature-x",
  createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z",
};

function session(overrides: Partial<TerminalSessionView>): TerminalSessionView {
  return {
    id: "s", projectId: atlas.id, tool: null, title: null, name: null, kind: "powershell", cwd: atlas.rootPath,
    providerConversationId: null, interruptedByShutdown: false, status: "idle", pid: 1, exitCode: null,
    createdAt: "2026-07-11T01:00:00.000Z", updatedAt: "2026-07-11T01:00:00.000Z", ...overrides,
  };
}
function document(overrides: Partial<DocumentPane>): DocumentPane {
  return { id: "file:C:\\work\\atlas\\README.md", kind: "file", label: "README.md", detail: "Atlas", dirty: false,
    owner: { kind: "project", id: atlas.id }, ...overrides };
}
const build = (input: Partial<Parameters<typeof buildSessionPanelItems>[0]>) =>
  buildSessionPanelItems({ sessions: [], documentPanes: [], projects: [atlas, dashboard], worktrees: [worktree], agents, unread: {}, ...input });

describe("sessionRank", () => {
  it("승인 대기 → 입력 대기 → 작업 중/시작 중 → 나머지 순서다", () => {
    expect(sessionRank("awaiting-approval", null)).toBe(0);
    expect(sessionRank("awaiting-input", null)).toBe(1);
    expect(sessionRank("working", null)).toBe(2);
    expect(sessionRank("starting", null)).toBe(2);
    expect(sessionRank("idle", null)).toBe(3);
    expect(sessionRank("exited", null)).toBe(3);
    expect(sessionRank("error", null)).toBe(3);
  });

  it("화면 밖에서 시작된 대기(unread)는 상태가 지나갔어도 그 등급으로 올라온다", () => {
    expect(sessionRank("idle", "approval")).toBe(0);
    expect(sessionRank("working", "input")).toBe(1);
    // 상태가 더 급하면 상태가 이긴다.
    expect(sessionRank("awaiting-approval", "input")).toBe(0);
  });
});

describe("buildSessionPanelItems", () => {
  it("승인 대기가 맨 위, 같은 등급은 updatedAt 내림차순, 동률은 id 오름차순이다", () => {
    const items = build({
      sessions: [
        session({ id: "b-idle", status: "idle", updatedAt: "2026-07-11T03:00:00.000Z" }),
        session({ id: "a-idle", status: "idle", updatedAt: "2026-07-11T03:00:00.000Z" }),
        session({ id: "working-old", status: "working", updatedAt: "2026-07-11T01:00:00.000Z" }),
        session({ id: "working-new", status: "working", updatedAt: "2026-07-11T02:00:00.000Z" }),
        session({ id: "input", status: "awaiting-input" }),
        session({ id: "approval", status: "awaiting-approval" }),
      ],
    });
    expect(items.map((item) => item.id)).toEqual(["approval", "input", "working-new", "working-old", "a-idle", "b-idle"]);
  });

  it("unread 승인 대기는 상태가 idle이어도 맨 위로 온다", () => {
    const items = build({
      sessions: [session({ id: "input", status: "awaiting-input" }), session({ id: "stale", status: "idle" })],
      unread: { stale: "approval" },
    });
    expect(items.map((item) => item.id)).toEqual(["stale", "input"]);
    expect(items[0]).toMatchObject({ kind: "session", attention: "approval", rank: 0 });
  });

  it("문서 패인은 어떤 세션보다 뒤에, 받은 순서 그대로 선다", () => {
    const items = build({
      sessions: [session({ id: "exited", status: "exited" })],
      documentPanes: [document({ id: "file:b", label: "b.md" }), document({ id: "file:a", label: "a.md" })],
    });
    expect(items.map((item) => item.id)).toEqual(["exited", "file:b", "file:a"]);
    expect(items[1]).toMatchObject({ kind: "document", rank: 5, document: "file", dirty: false });
  });

  it("폴더 세션은 폴더명을, worktree 세션은 브랜치를, 도구 세션은 '도구'를 소속으로 단다", () => {
    const items = build({
      sessions: [
        session({ id: "folder" }),
        session({ id: "wt", worktreeId: worktree.id, cwd: worktree.path }),
        session({ id: "tool", projectId: null, tool: "claude-update", kind: "claude" }),
      ],
    });
    const byId = Object.fromEntries(items.map((item) => [item.id, item]));
    expect(byId.folder).toMatchObject({ place: "Atlas", branch: null, projectId: atlas.id, worktreeId: null });
    expect(byId.wt).toMatchObject({ place: "Atlas", branch: "feature-x", projectId: atlas.id, worktreeId: worktree.id });
    expect(byId.tool).toMatchObject({ place: "도구", branch: null, projectId: null, worktreeId: null, tool: true });
  });

  it("같은 폴더의 이름 없는 같은 에이전트 세션은 번호가 붙고, 다른 폴더는 따로 센다", () => {
    const items = build({
      sessions: [
        session({ id: "p1", createdAt: "2026-07-11T01:00:00.000Z" }),
        session({ id: "p2", createdAt: "2026-07-11T02:00:00.000Z" }),
        session({ id: "d1", projectId: dashboard.id, cwd: dashboard.rootPath }),
      ],
    });
    const labels = Object.fromEntries(items.map((item) => [item.id, item.label]));
    expect(labels).toEqual({ p1: "PowerShell 1", p2: "PowerShell 2", d1: "PowerShell" });
  });

  it("worktree에서 연 문서는 그 worktree의 브랜치와 소유 폴더를 물려받는다", () => {
    const [item] = build({ documentPanes: [document({ owner: { kind: "worktree", id: worktree.id } })] });
    expect(item).toMatchObject({ kind: "document", place: "Atlas", branch: "feature-x", projectId: atlas.id, worktreeId: worktree.id });
  });

  it("소유자가 없는 문서와 사라진 폴더의 세션은 소속 없이 선다", () => {
    const items = build({
      sessions: [session({ id: "orphan", projectId: "project-gone" })],
      documentPanes: [document({ owner: null })],
    });
    expect(items[0]).toMatchObject({ id: "orphan", place: null, projectId: "project-gone" });
    expect(items[1]).toMatchObject({ kind: "document", place: null, projectId: null });
  });
});

describe("matchesScope", () => {
  const folder = build({ sessions: [session({ id: "folder" })] })[0];
  const wt = build({ sessions: [session({ id: "wt", worktreeId: worktree.id })] })[0];
  const tool = build({ sessions: [session({ id: "tool", projectId: null, tool: "claude-update" })] })[0];

  it("none은 전부 통과시킨다", () => {
    for (const item of [folder, wt, tool]) expect(matchesScope(item, { kind: "none" })).toBe(true);
  });

  it("worktree 대상은 그 worktree의 항목만 남긴다", () => {
    const target = { kind: "worktree" as const, worktreeId: worktree.id, label: "feature-x" };
    expect(matchesScope(wt, target)).toBe(true);
    expect(matchesScope(folder, target)).toBe(false);
  });

  it("폴더 대상은 그 폴더의 worktree 세션까지 포함하고, 도구 세션은 어디에도 들지 않는다", () => {
    const target = { kind: "folders" as const, projectIds: [atlas.id], label: "Atlas" };
    expect(matchesScope(folder, target)).toBe(true);
    expect(matchesScope(wt, target)).toBe(true);
    expect(matchesScope(tool, target)).toBe(false);
    expect(matchesScope(folder, { kind: "folders", projectIds: [dashboard.id], label: "Dashboard" })).toBe(false);
  });
});

describe("sessionPanelWaitCount", () => {
  it("승인·입력 대기 세션만 센다 — 문서와 작업 중은 빼고", () => {
    const items = build({
      sessions: [
        session({ id: "a", status: "awaiting-approval" }),
        session({ id: "b", status: "awaiting-input" }),
        session({ id: "c", status: "working" }),
        session({ id: "d", status: "idle" }),
      ],
      documentPanes: [document({})],
      unread: { d: "input" },
    });
    expect(sessionPanelWaitCount(items)).toBe(3);
  });
});
