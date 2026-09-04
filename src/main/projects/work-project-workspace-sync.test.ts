// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SharedProject } from "../../shared/project-types";
import type { WorkspaceShellInfo, WorkspaceSnapshot } from "../../shared/workspace-types";
import { workspacePathKey } from "../../shared/workspace-path";
import { readProjectTags, setProjectTags, updateProjectTags } from "./project-tags-registry";
import { readWorkProjectRegistry } from "./work-project-registry";
import { WorkProjectService } from "./work-project-service";
import { readWorkspaceRegistry } from "./workspace-registry";

/**
 * `syncFromWorkspace`가 지키기로 한 선을 검사한다. 이 기능이 잘못 도는 방식은 하나뿐이다 —
 * 사용자가 손으로 만들어 둔 묶음을 워크스페이스가 덮어쓰는 것. 그래서 테스트도 거기에 몰려 있다.
 */

const tempRoots: string[] = [];
// 3형제 배치(루트 CLAUDE.md §1): work·dev·data 는 드라이브 직하위 형제 폴더다.
const WORK_ROOT = "C:\\work";
const DEV_ROOT = "C:\\dev";
const DATA_ROOT = "C:\\data";
const IDS = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"];
const MANUAL_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

async function tempPaths(
  name: string,
): Promise<{ registryPath: string; workspaceRegistryPath: string; projectTagsPath: string }> {
  const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), `mcw-${name}-`));
  tempRoots.push(root);
  return {
    registryPath: path.join(root, "work-projects.json"),
    workspaceRegistryPath: path.join(root, "workspace.json"),
    projectTagsPath: path.join(root, "project-tags.json"),
  };
}

function service(
  paths: { registryPath: string; workspaceRegistryPath: string; projectTagsPath: string },
  ids = [...IDS],
  extra: { defaultCategory?: () => string } = {},
): WorkProjectService {
  const queue = [...ids];
  return new WorkProjectService({
    ...paths,
    ...extra,
    platform: "win32",
    now: () => "2026-08-30T00:00:00.000Z",
    idFactory: () => queue.shift() ?? "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  });
}

function shell(overrides: Partial<WorkspaceShellInfo> & Pick<WorkspaceShellInfo, "channel" | "shell">): WorkspaceShellInfo {
  const ref = `${overrides.channel}/${overrides.shell}`;
  return {
    root: WORK_ROOT,
    ref,
    channelLetter: overrides.channel.charAt(0),
    channelLabel: "용역",
    title: overrides.shell,
    status: "active",
    path: path.win32.join(WORK_ROOT, overrides.channel, overrides.shell),
    repos: [],
    externalPaths: [],
    data: [],
    ...overrides,
  };
}

function snapshot(shells: WorkspaceShellInfo[], shellLinks: WorkspaceSnapshot["registry"]["shellLinks"] = []): WorkspaceSnapshot {
  const repoOwners: Record<string, string> = {};
  for (const entry of shells) {
    for (const repo of entry.repos) {
      repoOwners[workspacePathKey(path.win32.join(DEV_ROOT, repo), "win32")] = entry.ref;
    }
    for (const external of entry.externalPaths) {
      repoOwners[workspacePathKey(external, "win32")] = entry.ref;
    }
  }
  return {
    registry: {
      schemaVersion: 1,
      updatedAt: "2026-08-30T00:00:00.000Z",
      roots: [{ work: WORK_ROOT, dev: DEV_ROOT, data: DATA_ROOT, label: "work-root" }],
      shellLinks,
    },
    shells,
    repoOwners,
    warnings: [],
  };
}

function project(id: string, rootPath: string): SharedProject {
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
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

const VSP = shell({ channel: "O_SMCH", shell: "24_SMCH_VSP-1", title: "가상수술계획", repos: ["VSP_FastAPI", "VSP_MQ_v2"] });
const CAREER = shell({
  channel: "P_Personal",
  shell: "26_Personal_Career-1",
  channelLabel: "개인",
  title: "진로",
  repos: [],
});
const REPO_PROJECT = project("11111111-1111-4111-8111-111111111111", "C:\\dev\\VSP_FastAPI");
const DOCS_PROJECT = project("22222222-2222-4222-8222-222222222222", "C:\\work\\O_SMCH\\24_SMCH_VSP-1");
const OUTSIDE_PROJECT = project("33333333-3333-4333-8333-333333333333", "D:\\elsewhere\\repo");

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("syncFromWorkspace", () => {
  it("creates one work project per shell, with the default 구분 when no getter is wired", async () => {
    const paths = await tempPaths("sync-create");
    const result = await service(paths).syncFromWorkspace(snapshot([VSP, CAREER]), []);

    expect(result.created).toBe(2);
    expect(result.skipped).toEqual([]);
    const created = Object.values(result.workProjects.workProjects);
    // 채널 글자는 구분을 정하지 않는다 — 채널 라벨은 태그로만 남고, 구분은 설정의 기본값이다.
    expect(created.map((workProject) => [workProject.name, workProject.category])).toEqual([
      ["O_SMCH/24_SMCH_VSP-1", "기타"],
      ["P_Personal/26_Personal_Career-1", "기타"],
    ]);
    // 출처는 workspace.json에만 남는다 — work-projects.json 스키마는 그대로다(계약 §8).
    const workspace = await readWorkspaceRegistry({ registryPath: paths.workspaceRegistryPath });
    expect(workspace.shellLinks).toEqual([
      { workProjectId: IDS[0], root: WORK_ROOT, channel: "O_SMCH", shell: "24_SMCH_VSP-1" },
      { workProjectId: IDS[1], root: WORK_ROOT, channel: "P_Personal", shell: "26_Personal_Career-1" },
    ]);
  });

  it("셸에서 만들어지는 업무 프로젝트는 설정의 기본 구분을 받는다", async () => {
    const paths = await tempPaths("sync-default-category");
    const shells = [
      shell({ channel: "G_StartupGrowth", shell: "26_StartupGrowth-1" }),
      shell({ channel: "O_SMCH", shell: "24_SMCH_VSP-1" }),
      shell({ channel: "P_Personal", shell: "26_Personal_Career-1" }),
    ];
    const result = await service(paths, shells.map((_, index) => `${index}${IDS[0].slice(1)}`), {
      defaultCategory: () => "업무",
    }).syncFromWorkspace(snapshot(shells), []);
    expect(Object.values(result.workProjects.workProjects).map((workProject) => workProject.category)).toEqual([
      "업무",
      "업무",
      "업무",
    ]);
  });

  it("files open folders as repo or docs members and ignores folders outside the workspace", async () => {
    const paths = await tempPaths("sync-members");
    const result = await service(paths).syncFromWorkspace(snapshot([VSP]), [
      REPO_PROJECT,
      DOCS_PROJECT,
      OUTSIDE_PROJECT,
    ]);
    expect(result.workProjects.workProjects[IDS[0]].members).toEqual([
      { projectId: REPO_PROJECT.id, role: "repo" },
      { projectId: DOCS_PROJECT.id, role: "docs" },
    ]);
  });

  it("refreshes members on a later run without touching the metadata the user owns", async () => {
    const paths = await tempPaths("sync-refresh");
    await service(paths).syncFromWorkspace(snapshot([VSP]), [REPO_PROJECT]);
    // 사용자가 이름·구분·상태·메모를 손봤다.
    await service(paths).updateWorkProjectMetadata(IDS[0], {
      name: "가상수술계획 (내 이름)",
      category: "연구",
      status: "진행중",
      memo: "메모",
    });

    const links = (await readWorkspaceRegistry({ registryPath: paths.workspaceRegistryPath })).shellLinks;
    const second = await service(paths).syncFromWorkspace(snapshot([VSP], links), [REPO_PROJECT, DOCS_PROJECT]);

    expect(second.created).toBe(0);
    const workProject = second.workProjects.workProjects[IDS[0]];
    expect(workProject).toMatchObject({ name: "가상수술계획 (내 이름)", category: "연구", status: "진행중", memo: "메모" });
    expect(workProject.members).toHaveLength(2);
  });

  it("skips a shell whose name a manual work project already uses, without overwriting it", async () => {
    const paths = await tempPaths("sync-collision");
    const manual = service(paths, [MANUAL_ID]);
    await manual.createWorkProject({ name: "O_SMCH/24_SMCH_VSP-1", category: "상품개발" });
    await manual.addMember(MANUAL_ID, DOCS_PROJECT.id, "docs");

    const result = await service(paths).syncFromWorkspace(snapshot([VSP]), [REPO_PROJECT, DOCS_PROJECT]);

    expect(result.created).toBe(0);
    expect(result.skipped).toEqual(["O_SMCH/24_SMCH_VSP-1"]);
    expect(Object.keys(result.workProjects.workProjects)).toEqual([MANUAL_ID]);
    expect(result.workProjects.workProjects[MANUAL_ID]).toMatchObject({
      category: "상품개발",
      members: [{ projectId: DOCS_PROJECT.id, role: "docs" }],
    });
  });

  it("leaves a folder the user filed under a manual work project where they put it", async () => {
    const paths = await tempPaths("sync-manual-member");
    const manual = service(paths, [MANUAL_ID]);
    await manual.createWorkProject({ name: "내가 만든 묶음" });
    await manual.addMember(MANUAL_ID, REPO_PROJECT.id, "repo");

    const result = await service(paths, [IDS[0]]).syncFromWorkspace(snapshot([VSP]), [REPO_PROJECT, DOCS_PROJECT]);

    expect(result.workProjects.workProjects[MANUAL_ID].members).toEqual([
      { projectId: REPO_PROJECT.id, role: "repo" },
    ]);
    // 셸에서 만들어진 쪽은 남은 폴더만 데려간다.
    expect(result.workProjects.workProjects[IDS[0]].members).toEqual([
      { projectId: DOCS_PROJECT.id, role: "docs" },
    ]);
  });

  it("moves a folder to its shell when the shell it used to belong to is gone", async () => {
    const paths = await tempPaths("sync-move");
    await service(paths).syncFromWorkspace(snapshot([VSP]), [REPO_PROJECT]);
    const links = (await readWorkspaceRegistry({ registryPath: paths.workspaceRegistryPath })).shellLinks;

    // 레포가 다른 셸로 옮겨 갔다(프론트매터 repos:가 바뀐 상황).
    const moved = shell({ channel: "O_SMCH", shell: "25_SMCH_FOAA-1", title: "FOAA", repos: ["VSP_FastAPI"] });
    const second = await service(paths, [IDS[1]]).syncFromWorkspace(snapshot([VSP, moved], links), [REPO_PROJECT]);

    expect(second.workProjects.workProjects[IDS[0]].members).toEqual([]);
    expect(second.workProjects.workProjects[IDS[1]].members).toEqual([
      { projectId: REPO_PROJECT.id, role: "repo" },
    ]);
  });

  it("drops a link whose work project the user deleted and makes the shell a fresh one", async () => {
    const paths = await tempPaths("sync-deleted");
    await service(paths).syncFromWorkspace(snapshot([VSP]), [REPO_PROJECT]);
    const links = (await readWorkspaceRegistry({ registryPath: paths.workspaceRegistryPath })).shellLinks;
    await service(paths).removeWorkProject(IDS[0]);

    const second = await service(paths, [IDS[2]]).syncFromWorkspace(snapshot([VSP], links), [REPO_PROJECT]);
    expect(second.created).toBe(1);
    expect(Object.keys(second.workProjects.workProjects)).toEqual([IDS[2]]);
    expect((await readWorkspaceRegistry({ registryPath: paths.workspaceRegistryPath })).shellLinks).toEqual([
      { workProjectId: IDS[2], root: WORK_ROOT, channel: "O_SMCH", shell: "24_SMCH_VSP-1" },
    ]);
  });

  it("writes a registry the parser accepts — no folder claimed by two work projects", async () => {
    const paths = await tempPaths("sync-invariant");
    await service(paths).syncFromWorkspace(snapshot([VSP]), [REPO_PROJECT, DOCS_PROJECT]);
    const links = (await readWorkspaceRegistry({ registryPath: paths.workspaceRegistryPath })).shellLinks;
    const registry = await readWorkProjectRegistry({ registryPath: paths.registryPath });
    expect(Object.keys(registry.workProjects)).toHaveLength(1);

    // 셸이 사라져도(루트가 잠시 안 보이는 상황) 남은 소속이 중복으로 남지 않는다.
    const second = await service(paths, [IDS[1]]).syncFromWorkspace(
      snapshot([shell({ channel: "O_SMCH", shell: "25_SMCH_FOAA-1", repos: ["VSP_FastAPI"] })], links),
      [REPO_PROJECT, DOCS_PROJECT],
    );
    const owners = Object.values(second.workProjects.workProjects).flatMap((workProject) =>
      workProject.members.map((member) => member.projectId),
    );
    expect(new Set(owners).size).toBe(owners.length);
  });

  it("does nothing when the workspace has no shells", async () => {
    const paths = await tempPaths("sync-empty");
    const result = await service(paths).syncFromWorkspace(snapshot([]), [REPO_PROJECT]);
    expect(result).toMatchObject({ created: 0, skipped: [] });
    expect(result.workProjects.workProjects).toEqual({});
  });

  it("seeds the channel label as a tag on a newly created work project", async () => {
    const paths = await tempPaths("tags-seed-created");
    await service(paths).syncFromWorkspace(snapshot([VSP, CAREER]), []);

    const tags = await readProjectTags({ registryPath: paths.projectTagsPath });
    expect(tags.tags).toEqual({
      [IDS[0]]: ["용역"],
      [IDS[1]]: ["개인"],
    });
  });

  it("backfills the channel label once for a work project that already exists but has no tag row yet", async () => {
    const paths = await tempPaths("tags-seed-upgrade");
    await service(paths).syncFromWorkspace(snapshot([VSP]), []);
    const links = (await readWorkspaceRegistry({ registryPath: paths.workspaceRegistryPath })).shellLinks;

    // project-tags.json이 아직 없던 상황(이 기능이 생기기 전)을 흉내 낸다: 행을 지운다.
    await updateProjectTags((registry) => ({ ...registry, tags: {} }), {
      registryPath: paths.projectTagsPath,
      now: () => "2026-08-30T00:00:00.000Z",
    });

    await service(paths, [IDS[1]]).syncFromWorkspace(snapshot([VSP], links), []);

    const tags = await readProjectTags({ registryPath: paths.projectTagsPath });
    expect(tags.tags).toEqual({ [IDS[0]]: ["용역"] });
  });

  it("leaves an emptied tag row alone instead of re-seeding the channel label", async () => {
    const paths = await tempPaths("tags-seed-cleared");
    await service(paths).syncFromWorkspace(snapshot([VSP]), []);
    const links = (await readWorkspaceRegistry({ registryPath: paths.workspaceRegistryPath })).shellLinks;

    // 사용자가 태그를 전부 지웠다 — 빈 배열 행이 남는다.
    await setProjectTags(IDS[0], [], {
      registryPath: paths.projectTagsPath,
      now: () => "2026-08-30T00:00:01.000Z",
    });

    await service(paths, [IDS[1]]).syncFromWorkspace(snapshot([VSP], links), []);

    const tags = await readProjectTags({ registryPath: paths.projectTagsPath });
    expect(tags.tags).toEqual({ [IDS[0]]: [] });
  });

  it("prunes tag rows for vanished work projects and skips the write when there is nothing to change", async () => {
    const paths = await tempPaths("tags-prune");
    const withClock = (nowIso: string, ids = [...IDS]) => {
      const queue = [...ids];
      return new WorkProjectService({
        ...paths,
        platform: "win32",
        now: () => nowIso,
        idFactory: () => queue.shift() ?? "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      });
    };

    await withClock("2026-08-30T00:00:00.000Z").syncFromWorkspace(snapshot([VSP, CAREER]), []);

    // CAREER 업무 프로젝트를 사용자가 지웠다 — 태그 행도 함께 정리되어야 한다.
    await withClock("2026-08-30T00:00:00.000Z").removeWorkProject(IDS[1]);
    const linksAfterRemoval = (await readWorkspaceRegistry({ registryPath: paths.workspaceRegistryPath })).shellLinks;

    await withClock("2026-08-30T01:00:00.000Z", [IDS[2]]).syncFromWorkspace(snapshot([VSP], linksAfterRemoval), []);
    const tagsAfterPrune = await readProjectTags({ registryPath: paths.projectTagsPath });
    expect(tagsAfterPrune.tags).toEqual({ [IDS[0]]: ["용역"] });
    expect(tagsAfterPrune.updatedAt).toBe("2026-08-30T01:00:00.000Z");

    // 정리할 것도 새로 심을 것도 없으면 태그 파일을 다시 쓰지 않는다 — updatedAt이 그대로다.
    const linksAfterPrune = (await readWorkspaceRegistry({ registryPath: paths.workspaceRegistryPath })).shellLinks;
    await withClock("2026-08-30T02:00:00.000Z").syncFromWorkspace(snapshot([VSP], linksAfterPrune), []);
    const tagsAfterNoop = await readProjectTags({ registryPath: paths.projectTagsPath });
    expect(tagsAfterNoop.updatedAt).toBe("2026-08-30T01:00:00.000Z");
    expect(tagsAfterNoop.tags).toEqual({ [IDS[0]]: ["용역"] });
  });
});
