// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { ProjectRegistryV1, SharedProject } from "../../shared/project-types";
import type { WorkProject } from "../../shared/work-project-types";
import { workspacePathKey } from "../../shared/workspace-path";
import type { WorkspaceShellInfo, WorkspaceSnapshot } from "../../shared/workspace-types";
import { repoSyncKey } from "./engine/paths";
import { resolveWorkProjectRepoPaths } from "./work-project-repos";

const WORK = "D:\\work";
const DEV = "D:\\dev";

function workProject(members: WorkProject["members"]): WorkProject {
  return {
    id: "wp-1",
    name: "VSP",
    category: "",
    status: null,
    memo: "",
    notionLinks: [],
    localFolders: [],
    members,
    order: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

function registry(projects: Record<string, string>): ProjectRegistryV1 {
  return {
    schemaVersion: 1,
    updatedAt: "2026-10-01T00:00:00.000Z",
    projects: Object.fromEntries(
      Object.entries(projects).map(([id, rootPath]) => [id, { id, rootPath } as unknown as SharedProject]),
    ),
  } as ProjectRegistryV1;
}

function shell(overrides: Partial<WorkspaceShellInfo> = {}): WorkspaceShellInfo {
  return {
    root: WORK,
    ref: "O_SMCH/24_SMCH_VSP-1",
    channel: "O_SMCH",
    shell: "24_SMCH_VSP-1",
    groupLabel: "",
    topics: [],
    title: "VSP",
    status: null,
    mode: null,
    archived: false,
    path: `${WORK}\\O_SMCH\\24_SMCH_VSP-1`,
    repos: ["VSP_FastAPI", "VSP_MQ"],
    externalPaths: ["C:\\NeuroPilot\\x"],
    data: [],
    drivePath: null,
    wikiPath: null,
    ...overrides,
  };
}

function snapshot(shells: WorkspaceShellInfo[], linked = true): WorkspaceSnapshot {
  return {
    registry: {
      schemaVersion: 1,
      updatedAt: "2026-10-01T00:00:00.000Z",
      roots: [{ work: WORK, dev: DEV, data: "D:\\data", label: "work" }],
      shellLinks: linked ? [{ workProjectId: "wp-1", root: WORK, channel: "O_SMCH", shell: "24_SMCH_VSP-1" }] : [],
    },
    shells,
    repoOwners: {},
    warnings: [],
  };
}

const everythingExists = () => true;

describe("resolveWorkProjectRepoPaths", () => {
  it("레포 멤버, 셸 repos, external_paths를 이 순서로 합치고 같은 레포는 한 번만 넣는다", () => {
    const paths = resolveWorkProjectRepoPaths(
      workProject([
        { projectId: "p1", role: "repo" },
        { projectId: "p2", role: "docs" },
      ]),
      registry({ p1: "d:\\DEV\\VSP_FastAPI\\", p2: "G:\\My Drive\\VSP" }),
      snapshot([shell()]),
      "win32",
      everythingExists,
    );
    expect(paths).toEqual(["d:\\DEV\\VSP_FastAPI\\", "D:\\dev\\VSP_MQ", "C:\\NeuroPilot\\x"]);
  });

  it("_archive로 옮겨진 휴면 레포는 빼고, 어디에도 없는 레포는 엔진이 '경로 없음'으로 보고하도록 남긴다", () => {
    const exists = (candidate: string) => candidate === "D:\\dev\\_archive\\VSP_MQ";
    const paths = resolveWorkProjectRepoPaths(workProject([]), registry({}), snapshot([shell()]), "win32", exists);
    expect(paths).toEqual(["D:\\dev\\VSP_FastAPI", "C:\\NeuroPilot\\x"]);
  });

  it("셸 링크가 없거나 워크스페이스가 없으면 레포 멤버만 쓴다", () => {
    const project = workProject([{ projectId: "p1", role: "repo" }]);
    const reg = registry({ p1: "D:\\dev\\solo", missing: "x" });
    expect(resolveWorkProjectRepoPaths(project, reg, snapshot([shell()], false), "win32", everythingExists)).toEqual([
      "D:\\dev\\solo",
    ]);
    expect(resolveWorkProjectRepoPaths(project, reg, null, "win32", everythingExists)).toEqual(["D:\\dev\\solo"]);
  });

  it("레지스트리에서 사라진 멤버는 조용히 건너뛴다", () => {
    const paths = resolveWorkProjectRepoPaths(
      workProject([{ projectId: "gone", role: "repo" }]),
      registry({}),
      null,
      "win32",
      everythingExists,
    );
    expect(paths).toEqual([]);
  });
});

describe("repoSyncKey ↔ workspacePathKey", () => {
  // 잠금 이름과 state.json 키가 HM과 mcw에서 갈라지지 않으려면 두 규칙이 절대경로에서 같은 답을 내야 한다(계약 §4).
  it.each([
    ["D:\\dev\\Repo", "win32"],
    ["d:/dev/Repo/", "win32"],
    ["D:\\dev\\Repo\\\\", "win32"],
    ["C:\\", "win32"],
    ["D:\\내 드라이브\\R_데이터코드", "win32"],
    ["/home/me/Repo/", "posix"],
    ["/", "posix"],
  ] as const)("%s (%s)", (candidate, style) => {
    expect(repoSyncKey(candidate, style === "win32" ? "win32" : "linux")).toBe(workspacePathKey(candidate, style));
  });
});
