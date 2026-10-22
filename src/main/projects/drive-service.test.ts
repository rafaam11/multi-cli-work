// @vitest-environment node

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SharedProject } from "../../shared/project-types";
import type { ProjectCategorySetting } from "../../shared/settings-types";
import type { WorkProject } from "../../shared/work-project-types";
import { DEFAULT_FOLDER_TEMPLATES } from "../../shared/folder-template";
import {
  assertDriveFolderName,
  createDriveProjectFolder,
  driveProjectStatus,
  scanDriveFolders,
} from "./drive-service";

const CATEGORIES: ProjectCategorySetting[] = [
  { name: "정부과제", color: 1, code: "G" },
  { name: "연구개발", color: 3, code: "R" },
  { name: "우리", color: 5, code: "U" },
];

function workProject(overrides: Partial<WorkProject>): WorkProject {
  return {
    id: "wp-1",
    name: "R_DOTORI",
    category: "연구개발",
    status: null,
    memo: "",
    notionLinks: [],
    localFolders: [],
    members: [],
    order: null,
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
    ...overrides,
  };
}

function folderProject(id: string, rootPath: string): SharedProject {
  return {
    id,
    rootPath,
    displayName: null,
    sources: ["manual"],
    providerRefs: { claude: [], codex: [] },
    status: null,
    memo: "",
    tracks: [],
    hidden: false,
    order: null,
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
  };
}

let base: string;
let drive: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), "mcw-drive-"));
  drive = path.join(base, "내 드라이브");
  for (const name of ["_archive", "share", "R_DOTORI", "U_결혼식", "G_보건의료과제", "X_모르는코드", "메모"]) {
    await mkdir(path.join(drive, name), { recursive: true });
  }
  await writeFile(path.join(drive, "README.md"), "# 규약", "utf8");
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("scanDriveFolders", () => {
  it("접두어 폴더만 고르고 구분·업무 프로젝트를 이름으로 잇는다", async () => {
    const overview = await scanDriveFolders(drive, CATEGORIES, [workProject({ id: "wp-dotori", name: "R_DOTORI" })]);
    expect(overview.available).toBe(true);
    expect(overview.folders).toEqual([
      { name: "G_보건의료과제", code: "G", category: "정부과제", workProjectId: null },
      { name: "R_DOTORI", code: "R", category: "연구개발", workProjectId: "wp-dotori" },
      { name: "U_결혼식", code: "U", category: "우리", workProjectId: null },
      { name: "X_모르는코드", code: "X", category: null, workProjectId: null },
    ]);
  });

  it("맥에서 올라온 NFD 이름도 같은 업무 프로젝트로 본다", async () => {
    const overview = await scanDriveFolders(drive, CATEGORIES, [workProject({ id: "wp-w", name: "U_결혼식".normalize("NFD") })]);
    expect(overview.folders.find((folder) => folder.code === "U")?.workProjectId).toBe("wp-w");
  });

  it("루트가 없거나 열리지 않으면 비어 있다", async () => {
    await expect(scanDriveFolders(null, CATEGORIES, [])).resolves.toEqual({ root: null, available: false, folders: [] });
    const missing = path.join(base, "없음");
    await expect(scanDriveFolders(missing, CATEGORIES, [])).resolves.toEqual({ root: missing, available: false, folders: [] });
  });
});

describe("driveProjectStatus", () => {
  it("같은 이름 폴더와 하위 폴더, 연결된 문서 멤버를 알려 준다", async () => {
    await mkdir(path.join(drive, "R_DOTORI", "3. 개발"), { recursive: true });
    await mkdir(path.join(drive, "R_DOTORI", ".claude"), { recursive: true });
    const linked = folderProject("p-docs", path.join(drive, "R_DOTORI"));
    const status = await driveProjectStatus({
      root: drive,
      workProject: workProject({ members: [{ projectId: "p-docs", role: "docs" }] }),
      projects: { [linked.id]: linked },
    });
    expect(status).toMatchObject({ folderPath: path.join(drive, "R_DOTORI"), exists: true, linkedProjectId: "p-docs", legacyDocs: [] });
    expect(status.subfolders.map((folder) => folder.name)).toEqual(["3. 개발"]);
  });

  it("드라이브 밖 문서 폴더는 같은 이름 드라이브 폴더로 옮기길 제안한다", async () => {
    const teams = path.join(base, "노바테크", "수행프로젝트(기술연구소) - 문서", "R_DOTORI");
    await mkdir(teams, { recursive: true });
    const legacy = folderProject("p-teams", teams);
    const gone = folderProject("p-gone", path.join(base, "사라진", "옛폴더"));
    const status = await driveProjectStatus({
      root: drive,
      workProject: workProject({
        members: [
          { projectId: "p-teams", role: "docs" },
          { projectId: "p-gone", role: "docs" },
        ],
      }),
      projects: { [legacy.id]: legacy, [gone.id]: gone },
    });
    expect(status.linkedProjectId).toBeNull();
    expect(status.legacyDocs).toEqual([
      { projectId: "p-teams", rootPath: teams, suggestedPath: path.join(drive, "R_DOTORI"), exists: true },
      // 이름이 다른 사라진 폴더도 업무 프로젝트 이름의 드라이브 폴더를 제안한다.
      { projectId: "p-gone", rootPath: gone.rootPath, suggestedPath: path.join(drive, "R_DOTORI"), exists: false },
    ]);
  });

  it("이미 등록된 드라이브 폴더는 다시 제안하지 않는다", async () => {
    const teams = path.join(base, "teams", "R_DOTORI");
    await mkdir(teams, { recursive: true });
    const legacy = folderProject("p-teams", teams);
    const already = folderProject("p-drive", path.join(drive, "R_DOTORI"));
    const status = await driveProjectStatus({
      root: drive,
      workProject: workProject({ members: [{ projectId: "p-teams", role: "docs" }] }),
      projects: { [legacy.id]: legacy, [already.id]: already },
    });
    expect(status.legacyDocs[0]?.suggestedPath).toBeNull();
  });

  it("드라이브 루트가 없으면 폴더 경로도 없다", async () => {
    const status = await driveProjectStatus({ root: null, workProject: workProject({}), projects: {} });
    expect(status).toMatchObject({ folderPath: null, exists: false, subfolders: [], linkedProjectId: null });
  });
});

describe("createDriveProjectFolder", () => {
  const minimal = DEFAULT_FOLDER_TEMPLATES[0]!.folders;

  it("템플릿 폴더와 CLAUDE.md를 만든다", async () => {
    const folder = await createDriveProjectFolder(drive, "R_바이브코딩", "연구개발", minimal);
    expect(folder).toBe(path.join(drive, "R_바이브코딩"));
    const entries = await readdir(folder);
    for (const name of minimal) expect(entries).toContain(name);
    expect(await readFile(path.join(folder, "CLAUDE.md"), "utf8")).toContain("- 구분: 연구개발");
  });

  it("하위 경로 항목은 중첩 폴더로 만든다", async () => {
    const folder = await createDriveProjectFolder(drive, "G_새과제", "정부과제", ["02_발표자료/회의록", "tmp"]);
    expect(await readdir(path.join(folder, "02_발표자료"))).toEqual(["회의록"]);
  });

  it("이미 있는 폴더의 사용자 파일은 덮어쓰지 않고 빠진 템플릿 폴더만 채운다", async () => {
    await writeFile(path.join(drive, "R_DOTORI", "CLAUDE.md"), "내 지식", "utf8");
    await createDriveProjectFolder(drive, "R_DOTORI", "연구개발", minimal);
    expect(await readFile(path.join(drive, "R_DOTORI", "CLAUDE.md"), "utf8")).toBe("내 지식");
    expect(await readdir(path.join(drive, "R_DOTORI"))).toContain("03_데이터");
  });

  it("템플릿 없이 만들면 빈 폴더다", async () => {
    const folder = await createDriveProjectFolder(drive, "S_커리어", "개인", null);
    expect(await readdir(folder)).toEqual([]);
  });

  it("템플릿 경로가 프로젝트 폴더 밖을 가리키면 아무것도 만들지 않는다", async () => {
    await expect(createDriveProjectFolder(drive, "R_탈출", "연구개발", ["../밖"])).rejects.toThrow(/템플릿 폴더 경로/);
    expect(await readdir(drive)).not.toContain("R_탈출");
  });

  it("드라이브 루트가 없거나 이름이 위험하면 만들지 않는다", async () => {
    await expect(createDriveProjectFolder(path.join(base, "없음"), "R_x", "연구개발", null)).rejects.toThrow(
      /드라이브 루트/,
    );
    expect(() => assertDriveFolderName("..")).toThrow();
    expect(() => assertDriveFolderName("R_a/b")).toThrow();
    expect(() => assertDriveFolderName("R_끝점.")).toThrow();
    expect(assertDriveFolderName(" R_DOTORI ")).toBe("R_DOTORI");
  });
});
