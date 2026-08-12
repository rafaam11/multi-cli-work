import type { SharedProject } from "@shared/project-types";
import type { WorkProject } from "@shared/work-project-types";
import type { SharedWorktree } from "@shared/worktree-types";
import { describe, expect, it } from "vitest";
import { paneContextOf, paneContextOfOwner, type PaneContextSources } from "./pane-context";

function project(id: string, rootPath: string, displayName: string | null = null): SharedProject {
  return {
    id,
    rootPath,
    displayName,
    sources: ["manual"],
    providerRefs: { claude: [], codex: [] },
    status: null,
    memo: "",
    tracks: [],
    hidden: false,
    order: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function worktree(id: string, projectId: string, branch: string): SharedWorktree {
  return {
    id,
    projectId,
    path: `C:\\work\\trees\\${branch}`,
    branch,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function workProject(id: string, name: string, category: string): WorkProject {
  return {
    id,
    name,
    category,
    status: null,
    memo: "",
    notionLinks: [],
    localFolders: [],
    members: [],
    order: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const SOURCES: PaneContextSources = {
  projects: [project("project-atlas", "C:\\work\\atlas"), project("project-solo", "C:\\work\\solo")],
  worktrees: [worktree("worktree-fix", "project-atlas", "feature/fix")],
  workProjects: [workProject("wp-1", "지반 모니터링", "정부지원과제")],
  membership: { "project-atlas": { workProjectId: "wp-1" } },
};

describe("paneContextOf", () => {
  it("names the folder a session at the repo root runs in, with no branch", () => {
    const context = paneContextOf({ projectId: "project-atlas", cwd: "C:\\work\\atlas" }, SOURCES);
    expect(context.folder).toBe("atlas");
    expect(context.branch).toBeNull();
  });

  it("adds the branch of the worktree the session belongs to", () => {
    const context = paneContextOf(
      { projectId: "project-atlas", worktreeId: "worktree-fix", cwd: "C:\\work\\trees\\feature/fix" },
      SOURCES,
    );
    expect(context.folder).toBe("atlas");
    expect(context.branch).toBe("feature/fix");
  });

  it("carries the owning work project and its category colour", () => {
    const context = paneContextOf({ projectId: "project-atlas", cwd: "C:\\work\\atlas" }, SOURCES);
    expect(context.workProject).toBe("지반 모니터링");
    expect(context.accentClass).toBe("category-government");
  });

  it("leaves a folder no work project claims without a name or a colour", () => {
    const context = paneContextOf({ projectId: "project-solo", cwd: "C:\\work\\solo" }, SOURCES);
    expect(context.folder).toBe("solo");
    expect(context.workProject).toBeNull();
    expect(context.accentClass).toBeNull();
  });

  it("calls a session that belongs to no folder a tool session", () => {
    const context = paneContextOf({ projectId: null, cwd: "C:\\Users\\PC" }, SOURCES);
    expect(context).toEqual({
      folder: "도구",
      branch: null,
      workProject: null,
      accentClass: null,
      title: "도구",
      tool: true,
    });
  });

  it("falls back to the working directory when the folder is no longer registered", () => {
    const context = paneContextOf({ projectId: "project-gone", cwd: "C:\\work\\archived-repo" }, SOURCES);
    expect(context.folder).toBe("archived-repo");
    expect(context.tool).toBe(false);
  });

  it("drops a branch whose worktree has been removed rather than naming a missing one", () => {
    const context = paneContextOf(
      { projectId: "project-atlas", worktreeId: "worktree-gone", cwd: "C:\\work\\trees\\old" },
      SOURCES,
    );
    expect(context.branch).toBeNull();
    expect(context.folder).toBe("atlas");
  });

  it("prefers the name the user gave the folder over its path", () => {
    const renamed: PaneContextSources = {
      ...SOURCES,
      projects: [project("project-atlas", "C:\\work\\atlas", "Atlas 본체")],
    };
    expect(paneContextOf({ projectId: "project-atlas", cwd: "C:\\work\\atlas" }, renamed).folder).toBe("Atlas 본체");
  });

  it("spells every part out in the title, skipping the ones the pane does not have", () => {
    const full = paneContextOf(
      { projectId: "project-atlas", worktreeId: "worktree-fix", cwd: "C:\\work\\trees\\feature/fix" },
      SOURCES,
    );
    expect(full.title).toBe("atlas · feature/fix · 지반 모니터링");
    expect(paneContextOf({ projectId: "project-solo", cwd: "C:\\work\\solo" }, SOURCES).title).toBe("solo");
  });
});

describe("paneContextOfOwner", () => {
  it("reads a folder-owned document the same way a session in that folder reads", () => {
    expect(paneContextOfOwner({ kind: "project", id: "project-atlas" }, SOURCES)).toEqual(
      paneContextOf({ projectId: "project-atlas", cwd: "C:\\work\\atlas" }, SOURCES),
    );
  });

  it("resolves a worktree-owned document to its folder and branch", () => {
    const context = paneContextOfOwner({ kind: "worktree", id: "worktree-fix" }, SOURCES);
    expect(context?.folder).toBe("atlas");
    expect(context?.branch).toBe("feature/fix");
    expect(context?.workProject).toBe("지반 모니터링");
  });

  it("says nothing for a document that belongs to no folder or to one that is gone", () => {
    expect(paneContextOfOwner(null, SOURCES)).toBeNull();
    expect(paneContextOfOwner({ kind: "project", id: "project-gone" }, SOURCES)).toBeNull();
    expect(paneContextOfOwner({ kind: "worktree", id: "worktree-gone" }, SOURCES)).toBeNull();
  });
});
