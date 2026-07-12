// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readProjectRegistry, updateProjectRegistry } from "./project-registry";
import { ProjectService, ProjectServiceError } from "./project-service";

const tempRoots: string[] = [];
const PROJECT_IDS = {
  missing: "11111111-1111-4111-8111-111111111111",
  shared: "22222222-2222-4222-8222-222222222222",
  manual: "33333333-3333-4333-8333-333333333333",
  project: "44444444-4444-4444-8444-444444444444",
  first: "55555555-5555-4555-8555-555555555555",
  second: "66666666-6666-4666-8666-666666666666",
} as const;

async function tempWorkspace(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), `mcw-${name}-`));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("ProjectService project management", () => {
  it("removes a project from the registry and leaves the folder on disk", async () => {
    const workspace = await tempWorkspace("service-remove");
    const registryPath = path.join(workspace, "registry", "projects.json");
    const keptDirectory = path.join(workspace, "kept");
    const removedDirectory = path.join(workspace, "removed");
    await Promise.all([fs.mkdir(keptDirectory), fs.mkdir(removedDirectory)]);
    const ids: string[] = [PROJECT_IDS.first, PROJECT_IDS.second];
    const service = new ProjectService({ registryPath, idFactory: () => ids.shift() ?? PROJECT_IDS.manual });
    await service.registerManualFolder(keptDirectory);
    await service.registerManualFolder(removedDirectory);

    const registry = await service.removeProject(PROJECT_IDS.second);

    expect(Object.keys(registry.projects)).toEqual([PROJECT_IDS.first]);
    expect((await readProjectRegistry({ registryPath })).registry.projects).not.toHaveProperty(PROJECT_IDS.second);
    expect((await fs.stat(removedDirectory)).isDirectory()).toBe(true);
    await expect(service.removeProject(PROJECT_IDS.second)).rejects.toThrow(/not found/i);
  });

  it("reports missing roots without mutating project registry records", async () => {
    const workspace = await tempWorkspace("service-missing-roots");
    const existingDirectory = path.join(workspace, "existing");
    const missingDirectory = path.join(workspace, "missing");
    await fs.mkdir(existingDirectory);
    const service = new ProjectService();
    const existing = {
      id: PROJECT_IDS.first,
      rootPath: existingDirectory,
      displayName: null,
      sources: ["manual" as const],
      providerRefs: { claude: [], codex: [] },
      status: null,
      memo: "",
      tracks: [],
      hidden: false,
      order: null,
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
    };
    const missing = { ...existing, id: PROJECT_IDS.second, rootPath: missingDirectory };
    const registry = {
      schemaVersion: 1 as const,
      updatedAt: "2026-07-11T00:00:00.000Z",
      projects: { [existing.id]: existing, [missing.id]: missing },
    };

    await expect(service.findMissingProjectRoots(registry)).resolves.toEqual([PROJECT_IDS.second]);
    expect(Object.keys(registry.projects[PROJECT_IDS.second])).not.toContain("rootMissing");
  });

  it("registers an existing absolute directory and rejects invalid manual paths", async () => {
    const workspace = await tempWorkspace("service-register");
    const registryPath = path.join(workspace, "registry", "projects.json");
    const projectDirectory = path.join(workspace, "manual-project");
    await fs.mkdir(projectDirectory);
    const service = new ProjectService({
      registryPath,
      now: () => "2026-07-11T02:00:00.000Z",
      idFactory: () => PROJECT_IDS.manual,
    });

    await expect(service.registerManualFolder("relative-project")).rejects.toThrow(ProjectServiceError);
    await expect(service.registerManualFolder(path.join(workspace, "missing"))).rejects.toThrow(/existing directory/i);

    const registry = await service.registerManualFolder(projectDirectory, "Manual project");

    expect(registry.projects[PROJECT_IDS.manual]).toMatchObject({
      rootPath: projectDirectory,
      displayName: "Manual project",
      sources: ["manual"],
    });
  });

  it("updates only mutable metadata while preserving project identity and provider references", async () => {
    const workspace = await tempWorkspace("service-metadata");
    const registryPath = path.join(workspace, "registry", "projects.json");
    const projectDirectory = path.join(workspace, "project");
    await fs.mkdir(projectDirectory);
    const service = new ProjectService({
      registryPath,
      now: () => "2026-07-11T03:00:00.000Z",
      idFactory: () => PROJECT_IDS.project,
    });
    await service.registerManualFolder(projectDirectory);

    const registry = await service.updateProjectMetadata(PROJECT_IDS.project, {
      displayName: "Renamed",
      status: "진행중",
      memo: "Next step",
      tracks: [{ id: "track-1", title: "Track", items: [{ id: "todo-1", text: "Ship", done: false }] }],
      hidden: true,
      order: 3,
    });

    expect(registry.projects[PROJECT_IDS.project]).toMatchObject({
      id: PROJECT_IDS.project,
      rootPath: projectDirectory,
      displayName: "Renamed",
      sources: ["manual"],
      providerRefs: { claude: [], codex: [] },
      status: "진행중",
      memo: "Next step",
      hidden: true,
      order: 3,
    });
    expect(registry.projects[PROJECT_IDS.project].updatedAt).toBe("2026-07-11T03:00:00.000Z");
  });

  it("relinks an existing project to a validated directory without changing its id or metadata", async () => {
    const workspace = await tempWorkspace("service-relink");
    const registryPath = path.join(workspace, "registry", "projects.json");
    const originalDirectory = path.join(workspace, "original");
    const relocatedDirectory = path.join(workspace, "relocated");
    await Promise.all([fs.mkdir(originalDirectory), fs.mkdir(relocatedDirectory)]);
    const service = new ProjectService({
      registryPath,
      now: () => "2026-07-11T04:00:00.000Z",
      idFactory: () => PROJECT_IDS.project,
    });
    await service.registerManualFolder(originalDirectory, "Relocatable");
    await updateProjectRegistry(
      (current) => ({
        ...current,
        projects: {
          ...current.projects,
          [PROJECT_IDS.project]: {
            ...current.projects[PROJECT_IDS.project],
            sources: ["codex"],
            providerRefs: { claude: [], codex: ["codex:C--relocatable"] },
          },
        },
      }),
      { registryPath },
    );

    const registry = await service.relinkProject(PROJECT_IDS.project, relocatedDirectory);

    expect(Object.keys(registry.projects)).toEqual([PROJECT_IDS.project]);
    expect(registry.projects[PROJECT_IDS.project]).toMatchObject({
      id: PROJECT_IDS.project,
      rootPath: relocatedDirectory,
      displayName: "Relocatable",
      sources: ["manual", "codex"],
    });
    expect((await readProjectRegistry({ registryPath })).registry).toEqual(registry);
  });

  it("rejects metadata updates for unknown projects and relinks that collide with another project", async () => {
    const workspace = await tempWorkspace("service-errors");
    const registryPath = path.join(workspace, "registry", "projects.json");
    const firstDirectory = path.join(workspace, "first");
    const secondDirectory = path.join(workspace, "second");
    await Promise.all([fs.mkdir(firstDirectory), fs.mkdir(secondDirectory)]);
    const ids: string[] = [PROJECT_IDS.first, PROJECT_IDS.second];
    const service = new ProjectService({ registryPath, idFactory: () => ids.shift() ?? PROJECT_IDS.manual });
    await service.registerManualFolder(firstDirectory);
    await service.registerManualFolder(secondDirectory);

    await expect(service.updateProjectMetadata("unknown-id", { memo: "No project" })).rejects.toThrow(/not found/i);
    await expect(service.relinkProject(PROJECT_IDS.first, secondDirectory)).rejects.toThrow(/already registered/i);
  });
});
