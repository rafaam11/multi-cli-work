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
    ...overrides,
  };
}

describe("buildQuickOpenItems", () => {
  it("lists folders and work projects with their tags", () => {
    const items = buildQuickOpenItems(sources());
    expect(items.find((item) => item.key === "project:p1")).toMatchObject({ label: "atlas", detail: "C:\\work\\atlas" });
    expect(items.find((item) => item.key === "work-project:w1")).toMatchObject({ detail: "#개인 #지식" });
  });

  it("leaves commands to the registry — 빠른 열기 is for going places", () => {
    expect(buildQuickOpenItems(sources()).some((item) => item.kind === "command")).toBe(false);
  });
});
