import type { SharedProject } from "@shared/project-types";
import type { WorkProject } from "@shared/work-project-types";
import { describe, expect, it } from "vitest";
import { buildTreeSections } from "./sidebar-tree";

const project = (id: string): SharedProject => ({
  id, rootPath: `C:\\dev\\${id}`, displayName: id, sources: ["manual"], providerRefs: { claude: [], codex: [] },
  status: null, memo: "", tracks: [], hidden: false, order: 0, createdAt: "2026-07-11T00:00:00.000Z", updatedAt: "2026-07-11T00:00:00.000Z",
});
const workProject = (id: string, name: string): WorkProject => ({
  id, name, category: "기타", status: null, memo: "", members: [], notionLinks: [], localFolders: [], order: null,
  createdAt: "2026-07-11T00:00:00.000Z", updatedAt: "2026-07-11T00:00:00.000Z",
});

describe("buildTreeSections", () => {
  it("업무 프로젝트마다 한 묶음, 남는 폴더는 미분류 묶음으로 간다", () => {
    const sections = buildTreeSections(
      [workProject("wp-a", "알파"), workProject("wp-b", "베타")],
      [project("a"), project("b")],
      { a: { workProjectId: "wp-a" } },
    );
    expect(sections.map((section) => section.key)).toEqual(["wp-a", "wp-b", "unassigned"]);
    expect(sections[2].projects.map((entry) => entry.id)).toEqual(["b"]);
  });

  it("업무 프로젝트가 하나도 없으면 미분류 묶음 하나만 남는다", () => {
    expect(buildTreeSections([], [project("a")], {})).toEqual([
      { key: "unassigned", workProject: null, projects: [project("a")] },
    ]);
  });
});
