import type { TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import { describe, expect, it } from "vitest";
import { recentProjects } from "./recent-folders";

function project(id: string, createdAt: string): SharedProject {
  return {
    id,
    rootPath: `C:\\work\\${id}`,
    displayName: id,
    sources: ["manual"],
    providerRefs: { claude: [], codex: [] },
    status: null,
    memo: "",
    tracks: [],
    hidden: false,
    order: 0,
    createdAt,
    updatedAt: createdAt,
  };
}

function session(projectId: string, updatedAt: string): TerminalSessionView {
  return {
    id: `${projectId}-${updatedAt}`,
    projectId,
    tool: null,
    title: null,
    name: null,
    kind: "powershell",
    cwd: `C:\\work\\${projectId}`,
    providerConversationId: null,
    interruptedByShutdown: false,
    status: "idle",
    pid: 100,
    exitCode: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("recentProjects", () => {
  it("puts the folder with the newest session first, whatever order the registry hands over", () => {
    const projects = [project("alpha", "2026-01-01T00:00:00.000Z"), project("beta", "2026-01-01T00:00:00.000Z")];
    const sessions = [
      session("alpha", "2026-08-01T00:00:00.000Z"),
      session("beta", "2026-08-05T00:00:00.000Z"),
      // An older session of beta's must not pull it back down.
      session("beta", "2026-02-01T00:00:00.000Z"),
    ];

    expect(recentProjects(projects, sessions).map((entry) => entry.id)).toEqual(["beta", "alpha"]);
  });

  it("falls back to when a folder was added, so one never worked in still has a place", () => {
    const projects = [project("older", "2026-01-01T00:00:00.000Z"), project("newer", "2026-06-01T00:00:00.000Z")];

    expect(recentProjects(projects, []).map((entry) => entry.id)).toEqual(["newer", "older"]);
  });

  it("stops at five folders, and lets a caller ask for fewer", () => {
    const projects = Array.from({ length: 8 }, (_, index) =>
      project(`p-${index}`, `2026-07-0${index + 1}T00:00:00.000Z`),
    );

    expect(recentProjects(projects, [])).toHaveLength(5);
    expect(recentProjects(projects, [], 2).map((entry) => entry.id)).toEqual(["p-7", "p-6"]);
  });

  it("leaves the array it was given alone", () => {
    const projects = [project("alpha", "2026-01-01T00:00:00.000Z"), project("beta", "2026-06-01T00:00:00.000Z")];
    recentProjects(projects, []);
    expect(projects.map((entry) => entry.id)).toEqual(["alpha", "beta"]);
  });
});
