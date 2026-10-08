import type { TerminalSessionView } from "@shared/api-types";
import type { AppStateV1 } from "@shared/app-state-types";
import type { SharedProject } from "@shared/project-types";
import type { SharedWorktree } from "@shared/worktree-types";
import { describe, expect, it } from "vitest";
import { planRestore, type RestoreInput } from "./restore-plan";

function project(id: string, order: number): SharedProject {
  return {
    id,
    rootPath: `C:\\work\\${id}`,
    displayName: id,
    sources: [],
    providerRefs: { claude: [], codex: [] },
    status: null,
    memo: "",
    tracks: [],
    hidden: false,
    order,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
  };
}

function session(id: string, projectId: string | null, updatedAt: string, worktreeId?: string): TerminalSessionView {
  return {
    id,
    projectId,
    worktreeId,
    tool: null,
    title: null,
    name: id,
    kind: "claude",
    cwd: "C:\\work",
    providerConversationId: null,
    interruptedByShutdown: false,
    status: "idle",
    pid: 1,
    exitCode: null,
    createdAt: updatedAt,
    updatedAt,
  } as TerminalSessionView;
}

const worktree: SharedWorktree = {
  id: "w1",
  projectId: "beta",
  path: "C:\\work\\beta-w1",
  branch: "feat/x",
  createdAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T00:00:00.000Z",
};

function state(overrides: Partial<AppStateV1> = {}): AppStateV1 {
  return { schemaVersion: 1, updatedAt: "", selectedProjectId: null, selectedSessionId: null, sessions: {}, ...overrides };
}

function input(overrides: Partial<RestoreInput> = {}): RestoreInput {
  return {
    projects: { alpha: project("alpha", 0), beta: project("beta", 1) },
    sessions: [
      session("a-old", "alpha", "2026-07-11T01:00:00.000Z"),
      session("a-new", "alpha", "2026-07-11T02:00:00.000Z"),
      session("b1", "beta", "2026-07-11T03:00:00.000Z"),
      session("tool", null, "2026-07-11T04:00:00.000Z"),
    ],
    worktrees: [worktree],
    state: state(),
    savedWorkspaceKey: null,
    collapsedProjectIds: new Set(),
    ...overrides,
  };
}

describe("planRestore", () => {
  it("opens the first folder on its most recent session when nothing was saved", () => {
    const plan = planRestore(input());
    expect(plan).toMatchObject({
      selectedProjectId: "alpha",
      selectedSessionId: "a-new",
      selectedWorktreeId: null,
      focusedPaneId: "a-new",
      activeView: "terminal",
    });
    expect(plan.folderViews.alpha!.slots.slice(0, 2)).toEqual(["a-new", "a-old"]);
  });

  it("brings back the saved folder and session", () => {
    const plan = planRestore(input({ state: state({ selectedProjectId: "beta", selectedSessionId: "b1" }) }));
    expect(plan).toMatchObject({ selectedProjectId: "beta", selectedSessionId: "b1", activeView: "terminal" });
  });

  it("opens the saved folder's detail page when its session is gone", () => {
    const plan = planRestore(input({ state: state({ selectedProjectId: "beta", selectedSessionId: "gone" }) }));
    expect(plan).toMatchObject({ selectedProjectId: "beta", selectedSessionId: null, activeView: "detail" });
  });

  it("keeps a tool session outside every folder", () => {
    const plan = planRestore(input({ state: state({ selectedProjectId: "alpha", selectedSessionId: "tool" }) }));
    expect(plan).toMatchObject({ selectedProjectId: null, selectedSessionId: "tool", focusedPaneId: "tool", activeView: "terminal" });
    expect(plan.folderViews["@tools"]!.slots).toContain("tool");
  });

  it("reopens the worktree that was last open", () => {
    const plan = planRestore(input({ savedWorkspaceKey: "worktree:w1" }));
    expect(plan).toMatchObject({ selectedProjectId: "beta", selectedWorktreeId: "w1" });
  });

  it("keeps the selection on screen when asked to and can stay on the home page", () => {
    const plan = planRestore(
      input({ savedWorkspaceKey: "worktree:w1", preservedSelection: { projectId: "alpha", sessionId: "a-old", view: "home" } }),
    );
    expect(plan).toMatchObject({ selectedProjectId: "alpha", selectedSessionId: "a-old", selectedWorktreeId: null, activeView: "home" });
  });

  it("leaves collapsed folders collapsed", () => {
    expect([...planRestore(input({ collapsedProjectIds: new Set(["beta"]) })).expandedProjects]).toEqual(["alpha"]);
  });
});
