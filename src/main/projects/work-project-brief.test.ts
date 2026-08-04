// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SharedProject } from "../../shared/project-types";
import type { WorkProject } from "../../shared/work-project-types";
import { renderWorkProjectBrief, writeWorkProjectBrief } from "./work-project-brief";

const tempRoots: string[] = [];

async function tempDir(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), `mcw-${name}-`));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

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
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

const WORK_PROJECT: WorkProject = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "스마트팩토리 과제",
  category: "정부지원과제",
  status: "진행중",
  memo: "1차년도 결과보고서 준비 중",
  notionUrl: "https://notion.so/smart-factory",
  members: [],
  order: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

describe("renderWorkProjectBrief", () => {
  it("lists notion url, teams docs folder and repos with local paths", () => {
    // Built with the platform's own separators: the display-name fallback goes through
    // path.basename, and a hard-coded Windows path never splits on the Linux CI runner.
    const agvControlPath = path.join("D:", "Project", "agv-control");
    const brief = renderWorkProjectBrief(WORK_PROJECT, [
      { project: project("1", agvControlPath), role: "repo" },
      { project: project("2", "C:\\Users\\PC\\노바테크\\수행프로젝트\\스마트팩토리", "스마트팩토리 문서"), role: "docs" },
      { project: project("3", "D:\\Project\\fleet-server", "fleet-server"), role: "repo" },
    ]);

    expect(brief).toContain("# 업무 프로젝트: 스마트팩토리 과제");
    expect(brief).toContain("- 구분: 정부지원과제");
    expect(brief).toContain("- 상태: 진행중");
    expect(brief).toContain("- 노션(프로젝트 관리): https://notion.so/smart-factory");
    expect(brief).toContain("- 스마트팩토리 문서: C:\\Users\\PC\\노바테크\\수행프로젝트\\스마트팩토리");
    expect(brief).toContain(`- agv-control: ${agvControlPath}`);
    expect(brief).toContain("- fleet-server: D:\\Project\\fleet-server");
    expect(brief).toContain("## 메모");
    // Docs section precedes repos so the official-document location leads.
    expect(brief.indexOf("팀즈 문서 폴더")).toBeLessThan(brief.indexOf("개발 레포"));
  });

  it("omits empty sections instead of rendering placeholders", () => {
    const brief = renderWorkProjectBrief(
      { ...WORK_PROJECT, status: null, notionUrl: null, memo: "" },
      [{ project: project("1", "D:\\Project\\agv-control"), role: "repo" }],
    );
    expect(brief).not.toContain("- 상태:");
    expect(brief).not.toContain("- 노션(프로젝트 관리):");
    expect(brief).not.toContain("팀즈 문서 폴더");
    expect(brief).not.toContain("## 메모");
  });
});

describe("writeWorkProjectBrief", () => {
  it("writes the brief under the work project id and returns the path", async () => {
    const briefDir = path.join(await tempDir("brief"), "project-briefs");
    const briefPath = await writeWorkProjectBrief(briefDir, WORK_PROJECT, []);
    expect(briefPath).toBe(path.join(briefDir, `${WORK_PROJECT.id}.md`));
    expect(await fs.readFile(briefPath, "utf8")).toContain("# 업무 프로젝트: 스마트팩토리 과제");
  });
});
