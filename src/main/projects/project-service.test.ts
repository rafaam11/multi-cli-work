// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readProjectRegistry, reconcileProject, updateProjectRegistry } from "./project-registry";
import { ProjectService, ProjectServiceError } from "./project-service";

const tempRoots: string[] = [];

async function tempWorkspace(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), `mcw-${name}-`));
  tempRoots.push(root);
  return root;
}

async function writeTranscript(filePath: string, records: unknown[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("ProjectService discovery", () => {
  it("reconciles Claude and Codex discoveries in one registry update without deleting missing projects", async () => {
    const workspace = await tempWorkspace("service-discovery");
    const registryPath = path.join(workspace, "registry", "projects.json");
    const claudeProjectsDirectory = path.join(workspace, "claude");
    const codexSessionsDirectory = path.join(workspace, "codex");
    const sharedProject = path.join(workspace, "shared-project");
    const missingProject = path.join(workspace, "missing-project");
    await fs.mkdir(sharedProject);
    await writeTranscript(path.join(claudeProjectsDirectory, "project", "claude.jsonl"), [
      { cwd: sharedProject, sessionId: "claude-session" },
    ]);
    await writeTranscript(path.join(codexSessionsDirectory, "2026", "07", "11", "codex.jsonl"), [
      { type: "session_meta", payload: { cwd: sharedProject, id: "codex-session" } },
    ]);
    await updateProjectRegistry(
      (registry) =>
        reconcileProject(
          registry,
          { rootPath: missingProject, source: "manual", displayName: "Keep me" },
          { now: "2026-07-11T00:00:00.000Z", idFactory: () => "missing-id" },
        ),
      { registryPath },
    );
    const registryUpdater = vi.fn(updateProjectRegistry);
    const service = new ProjectService({
      registryPath,
      claudeProjectsDirectory,
      codexSessionsDirectory,
      registryUpdater,
      now: () => "2026-07-11T01:00:00.000Z",
      idFactory: () => "shared-id",
    });

    const registry = await service.discoverAndReconcile();
    const codexProjectRef = `codex:${sharedProject[0].toUpperCase()}--${sharedProject.slice(3).replace(/[\\/]+/g, "-")}`;

    expect(registryUpdater).toHaveBeenCalledTimes(1);
    expect(Object.keys(registry.projects).sort()).toEqual(["missing-id", "shared-id"]);
    expect(registry.projects["missing-id"].displayName).toBe("Keep me");
    expect(registry.projects["shared-id"]).toMatchObject({
      rootPath: sharedProject,
      sources: ["claude", "codex"],
      providerRefs: { claude: ["project"], codex: [codexProjectRef] },
    });
  });
});

describe("ProjectService project management", () => {
  it("registers an existing absolute directory and rejects invalid manual paths", async () => {
    const workspace = await tempWorkspace("service-register");
    const registryPath = path.join(workspace, "registry", "projects.json");
    const projectDirectory = path.join(workspace, "manual-project");
    await fs.mkdir(projectDirectory);
    const service = new ProjectService({
      registryPath,
      now: () => "2026-07-11T02:00:00.000Z",
      idFactory: () => "manual-id",
    });

    await expect(service.registerManualFolder("relative-project")).rejects.toThrow(ProjectServiceError);
    await expect(service.registerManualFolder(path.join(workspace, "missing"))).rejects.toThrow(/existing directory/i);

    const registry = await service.registerManualFolder(projectDirectory, "Manual project");

    expect(registry.projects["manual-id"]).toMatchObject({
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
      idFactory: () => "project-id",
    });
    await service.registerManualFolder(projectDirectory);

    const registry = await service.updateProjectMetadata("project-id", {
      displayName: "Renamed",
      status: "진행중",
      memo: "Next step",
      tracks: [{ id: "track-1", title: "Track", items: [{ id: "todo-1", text: "Ship", done: false }] }],
      hidden: true,
      order: 3,
    });

    expect(registry.projects["project-id"]).toMatchObject({
      id: "project-id",
      rootPath: projectDirectory,
      displayName: "Renamed",
      sources: ["manual"],
      providerRefs: { claude: [], codex: [] },
      status: "진행중",
      memo: "Next step",
      hidden: true,
      order: 3,
    });
    expect(registry.projects["project-id"].updatedAt).toBe("2026-07-11T03:00:00.000Z");
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
      idFactory: () => "project-id",
    });
    await service.registerManualFolder(originalDirectory, "Relocatable");

    const registry = await service.relinkProject("project-id", relocatedDirectory);

    expect(Object.keys(registry.projects)).toEqual(["project-id"]);
    expect(registry.projects["project-id"]).toMatchObject({
      id: "project-id",
      rootPath: relocatedDirectory,
      displayName: "Relocatable",
      sources: ["manual"],
    });
    expect((await readProjectRegistry({ registryPath })).registry).toEqual(registry);
  });

  it("rejects metadata updates for unknown projects and relinks that collide with another project", async () => {
    const workspace = await tempWorkspace("service-errors");
    const registryPath = path.join(workspace, "registry", "projects.json");
    const firstDirectory = path.join(workspace, "first");
    const secondDirectory = path.join(workspace, "second");
    await Promise.all([fs.mkdir(firstDirectory), fs.mkdir(secondDirectory)]);
    const ids = ["first-id", "second-id"];
    const service = new ProjectService({ registryPath, idFactory: () => ids.shift() ?? "unexpected-id" });
    await service.registerManualFolder(firstDirectory);
    await service.registerManualFolder(secondDirectory);

    await expect(service.updateProjectMetadata("unknown-id", { memo: "No project" })).rejects.toThrow(/not found/i);
    await expect(service.relinkProject("first-id", secondDirectory)).rejects.toThrow(/already registered/i);
  });
});
