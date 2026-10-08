import type { AgentView } from "@shared/agent-types";
import type { SharedProject } from "@shared/project-types";
import type { WorkProject } from "@shared/work-project-types";
import { describe, expect, it } from "vitest";
import { buildQuickOpenItems, type QuickOpenSources } from "./quick-open-items";

const project = {
  id: "p1",
  rootPath: "C:\\work\\atlas",
  displayName: "atlas",
  order: 0,
} as SharedProject;

const claude = { id: "claude", label: "Claude", available: true } as AgentView;
const missing = { id: "codex", label: "Codex", available: false } as AgentView;

function sources(overrides: Partial<QuickOpenSources> = {}): QuickOpenSources {
  return {
    sessions: [],
    projects: [project],
    workspaceViews: [],
    workProjects: [{ id: "w1", name: "세컨드브레인" } as WorkProject],
    tagsByWorkProjectId: { w1: ["개인", "지식"] },
    agents: [claude, missing],
    selectedProject: project,
    ...overrides,
  };
}

describe("buildQuickOpenItems", () => {
  it("lists folders, work projects with their tags, and commands", () => {
    const items = buildQuickOpenItems(sources());
    expect(items.find((item) => item.key === "project:p1")).toMatchObject({ label: "atlas", detail: "C:\\work\\atlas" });
    expect(items.find((item) => item.key === "work-project:w1")).toMatchObject({ detail: "#개인 #지식" });
    expect(items.at(-1)).toMatchObject({ key: "command:settings" });
  });

  it("offers a new session only with installed agents on the selected folder", () => {
    const keys = buildQuickOpenItems(sources()).map((item) => item.key);
    expect(keys).toContain("command:new-session:claude");
    expect(keys).not.toContain("command:new-session:codex");
    expect(buildQuickOpenItems(sources({ selectedProject: null })).some((item) => item.key.startsWith("command:new-session"))).toBe(false);
  });
});
