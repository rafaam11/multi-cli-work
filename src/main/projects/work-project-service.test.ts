// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readWorkProjectRegistry } from "./work-project-registry";
import { WorkProjectService, WorkProjectServiceError } from "./work-project-service";

const tempRoots: string[] = [];
const IDS = {
  first: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  second: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  third: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
} as const;
const PROJECT_IDS = {
  repo: "11111111-1111-4111-8111-111111111111",
  docs: "22222222-2222-4222-8222-222222222222",
} as const;

async function tempRegistryPath(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), `mcw-${name}-`));
  tempRoots.push(root);
  return path.join(root, "work-projects.json");
}

function service(registryPath: string, ids: string[] = [IDS.first, IDS.second, IDS.third]): WorkProjectService {
  const queue = [...ids];
  return new WorkProjectService({
    registryPath,
    now: () => "2026-08-03T00:00:00.000Z",
    idFactory: () => queue.shift() ?? IDS.third,
  });
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("WorkProjectService", () => {
  it("creates a work project with defaults and trims inputs", async () => {
    const registryPath = await tempRegistryPath("wps-create");
    const registry = await service(registryPath).createWorkProject({ name: "  스마트팩토리 과제  " });
    const workProject = registry.workProjects[IDS.first];
    expect(workProject).toMatchObject({
      name: "스마트팩토리 과제",
      category: "기타",
      status: null,
      memo: "",
      notionLinks: [],
      localFolders: [],
      members: [],
      order: null,
    });
    await expect(service(registryPath).createWorkProject({ name: "  " })).rejects.toThrow(WorkProjectServiceError);
  });

  it("updates metadata, normalizing notion link rows and rejecting unknown fields", async () => {
    const registryPath = await tempRegistryPath("wps-update");
    const workProjectService = service(registryPath);
    await workProjectService.createWorkProject({ name: "과제", category: "정부지원과제" });

    const updated = await workProjectService.updateWorkProjectMetadata(IDS.first, {
      status: "진행중",
      memo: "메모",
      notionLinks: [
        { label: "  채널  ", url: "  https://notion.so/channel  " },
        { label: "", url: "https://notion.so/unlabeled" },
        { label: "빈 URL 초안", url: "   " },
      ],
    });
    expect(updated.workProjects[IDS.first]).toMatchObject({
      status: "진행중",
      memo: "메모",
      notionLinks: [
        { label: "채널", url: "https://notion.so/channel" },
        { label: "노션", url: "https://notion.so/unlabeled" },
      ],
    });

    const cleared = await workProjectService.updateWorkProjectMetadata(IDS.first, { notionLinks: [] });
    expect(cleared.workProjects[IDS.first].notionLinks).toEqual([]);

    await expect(
      workProjectService.updateWorkProjectMetadata(IDS.first, { teamsPath: "C:\\x" } as never),
    ).rejects.toThrow(/unknown fields/);
    await expect(
      workProjectService.updateWorkProjectMetadata(IDS.first, { notionUrl: "https://x" } as never),
    ).rejects.toThrow(/unknown fields/);
    await expect(workProjectService.updateWorkProjectMetadata(IDS.second, { memo: "x" })).rejects.toThrow(/not found/);
  });

  it("normalizes local folder rows, defaulting the label to the folder's own name", async () => {
    const registryPath = await tempRegistryPath("wps-folders");
    const workProjectService = service(registryPath);
    await workProjectService.createWorkProject({ name: "과제" });

    // Built with the platform's own separators so basename resolves on the Linux CI runner too.
    const drawings = path.join("D:", "Work", "참고자료", "도면");
    const deliverables = path.join("D:", "Work", "산출물");
    const updated = await workProjectService.updateWorkProjectMetadata(IDS.first, {
      localFolders: [
        { label: "  설계도면  ", path: `  ${drawings}  ` },
        { label: "", path: deliverables },
        { label: "빈 경로 초안", path: "   " },
      ],
    });
    expect(updated.workProjects[IDS.first].localFolders).toEqual([
      { label: "설계도면", path: drawings },
      { label: "산출물", path: deliverables },
    ]);

    const cleared = await workProjectService.updateWorkProjectMetadata(IDS.first, { localFolders: [] });
    expect(cleared.workProjects[IDS.first].localFolders).toEqual([]);
  });

  it("moves a folder between work projects on addMember instead of failing", async () => {
    const registryPath = await tempRegistryPath("wps-move");
    const workProjectService = service(registryPath);
    await workProjectService.createWorkProject({ name: "과제 A" });
    await workProjectService.createWorkProject({ name: "과제 B" });
    await workProjectService.addMember(IDS.first, PROJECT_IDS.repo, "repo");
    await workProjectService.addMember(IDS.first, PROJECT_IDS.docs, "docs");

    const moved = await workProjectService.addMember(IDS.second, PROJECT_IDS.repo, "repo");
    expect(moved.workProjects[IDS.first].members).toEqual([{ projectId: PROJECT_IDS.docs, role: "docs" }]);
    expect(moved.workProjects[IDS.second].members).toEqual([{ projectId: PROJECT_IDS.repo, role: "repo" }]);

    // Re-adding to the same work project just updates the role.
    const reroled = await workProjectService.addMember(IDS.second, PROJECT_IDS.repo, "docs");
    expect(reroled.workProjects[IDS.second].members).toEqual([{ projectId: PROJECT_IDS.repo, role: "docs" }]);
  });

  it("removes members and prunes references to deleted folder projects", async () => {
    const registryPath = await tempRegistryPath("wps-remove");
    const workProjectService = service(registryPath);
    await workProjectService.createWorkProject({ name: "과제" });
    await workProjectService.addMember(IDS.first, PROJECT_IDS.repo, "repo");
    await workProjectService.addMember(IDS.first, PROJECT_IDS.docs, "docs");

    const removed = await workProjectService.removeMember(IDS.first, PROJECT_IDS.docs);
    expect(removed.workProjects[IDS.first].members).toEqual([{ projectId: PROJECT_IDS.repo, role: "repo" }]);
    await expect(workProjectService.removeMember(IDS.first, PROJECT_IDS.docs)).rejects.toThrow(/not a member/);

    const pruned = await workProjectService.removeProjectReferences(PROJECT_IDS.repo);
    expect(pruned.workProjects[IDS.first].members).toEqual([]);
    // Pruning an unreferenced project is a no-op that does not bump updatedAt.
    const untouched = await workProjectService.removeProjectReferences(PROJECT_IDS.repo);
    expect(untouched).toEqual(pruned);
  });

  it("removes a work project, leaving folder projects untouched elsewhere", async () => {
    const registryPath = await tempRegistryPath("wps-delete");
    const workProjectService = service(registryPath);
    await workProjectService.createWorkProject({ name: "과제" });
    await workProjectService.addMember(IDS.first, PROJECT_IDS.repo, "repo");

    const registry = await workProjectService.removeWorkProject(IDS.first);
    expect(registry.workProjects).toEqual({});
    expect((await readWorkProjectRegistry({ registryPath })).workProjects).toEqual({});
    await expect(workProjectService.removeWorkProject(IDS.first)).rejects.toThrow(/not found/);
  });

  it("stores and clears the teams sync root", async () => {
    const registryPath = await tempRegistryPath("wps-teams-root");
    const workProjectService = service(registryPath);
    const set = await workProjectService.setTeamsSyncRoot("C:\\Users\\PC\\노바테크\\수행프로젝트");
    expect(set.teamsSyncRoot).toBe("C:\\Users\\PC\\노바테크\\수행프로젝트");
    const cleared = await workProjectService.setTeamsSyncRoot(null);
    expect(cleared.teamsSyncRoot).toBeNull();
    await expect(workProjectService.setTeamsSyncRoot("  " as never)).rejects.toThrow(WorkProjectServiceError);
  });

  it("reorders work projects in one transaction, keeping unlisted ids after listed ones", async () => {
    const registryPath = await tempRegistryPath("wps-reorder");
    const workProjectService = service(registryPath);
    await workProjectService.createWorkProject({ name: "A" });
    await workProjectService.createWorkProject({ name: "B" });
    await workProjectService.createWorkProject({ name: "C" });

    const reordered = await workProjectService.reorderWorkProjects([IDS.second]);
    expect(reordered.workProjects[IDS.second].order).toBe(0);
    const trailingOrders = [IDS.first, IDS.third].map((id) => reordered.workProjects[id].order);
    expect(trailingOrders).toEqual([1, 2]);

    await expect(workProjectService.reorderWorkProjects([IDS.first, IDS.first])).rejects.toThrow(/duplicate/);
    await expect(
      workProjectService.reorderWorkProjects(["dddddddd-dddd-4ddd-8ddd-dddddddddddd"]),
    ).rejects.toThrow(/unknown work projects/);
  });
});
