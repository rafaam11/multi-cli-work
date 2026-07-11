// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { registerMainIpc, type IpcRegistrar } from "./ipc";

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipc: IpcRegistrar = {
    handle: (channel, listener) => {
      handlers.set(channel, listener);
    },
  };
  const project = {
    id: "project-1",
    rootPath: "C:\\Work",
    displayName: "Work",
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
  const registry = { schemaVersion: 1 as const, updatedAt: project.updatedAt, projects: { [project.id]: project } };
  const projectService = {
    discoverAndReconcile: vi.fn(async () => registry),
    findMissingProjectRoots: vi.fn(async () => [project.id]),
    registerManualFolder: vi.fn(async () => registry),
    updateProjectMetadata: vi.fn(async () => registry),
    relinkProject: vi.fn(async () => registry),
  };
  const coordinator = {
    list: vi.fn(() => []),
    create: vi.fn(async (input) => input),
    attach: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    stop: vi.fn(),
    resume: vi.fn(),
    remove: vi.fn(),
    select: vi.fn(),
    state: vi.fn(async () => ({
      source: "primary" as const,
      writable: true,
      state: {
        schemaVersion: 1 as const,
        updatedAt: project.updatedAt,
        selectedProjectId: project.id,
        selectedSessionId: null,
        sessions: {},
      },
    })),
  };
  registerMainIpc(ipc, {
    projectService,
    coordinator,
    readRegistry: vi.fn(async () => ({ registry, source: "primary" as const, writable: true })),
    chooseDirectory: vi.fn(async () => "C:\\Work"),
    getAvailability: vi.fn(async () => ({ powershell: true, claude: true, codex: true })),
  });
  return { handlers, projectService, coordinator, project };
}

describe("main IPC boundary", () => {
  it("uses the main-process folder chooser for manual project registration", async () => {
    const { handlers, projectService, project } = setup();

    const result = await handlers.get("projects:add-folder")!({});

    expect(projectService.registerManualFolder).toHaveBeenCalledWith("C:\\Work", "Work");
    expect(result).toEqual(project);
  });

  it("rejects renderer attempts to inject a terminal executable or cwd", async () => {
    const { handlers, coordinator } = setup();

    await expect(
      handlers.get("terminals:create")!({}, {
        projectId: "project-1",
        kind: "codex",
        cols: 80,
        rows: 24,
        executable: "cmd.exe",
      }),
    ).rejects.toThrow(/unknown fields/i);
    expect(coordinator.create).not.toHaveBeenCalled();
  });

  it("rejects unknown project metadata fields", async () => {
    const { handlers, projectService } = setup();

    await expect(
      handlers.get("projects:update")!({}, "project-1", { displayName: "Work", rootPath: "D:\\Injected" }),
    ).rejects.toThrow(/unknown fields/i);
    expect(projectService.updateProjectMetadata).not.toHaveBeenCalled();
  });

  it("annotates project snapshots with missing root ids without changing registry projects", async () => {
    const { handlers, projectService, project } = setup();

    const listed = await handlers.get("projects:list")!({});
    const refreshed = await handlers.get("projects:refresh")!({});

    expect(listed).toMatchObject({ missingRootProjectIds: [project.id] });
    expect(refreshed).toMatchObject({ missingRootProjectIds: [project.id] });
    expect(projectService.findMissingProjectRoots).toHaveBeenCalledTimes(2);
    expect((listed as { registry: { projects: Record<string, unknown> } }).registry.projects[project.id]).not.toHaveProperty(
      "rootMissing",
    );
  });

  it("exposes the persisted selection through a read-only terminal state channel", async () => {
    const { handlers, coordinator, project } = setup();

    await expect(handlers.get("terminals:state")!({})).resolves.toMatchObject({
      state: { selectedProjectId: project.id, selectedSessionId: null },
    });
    expect(coordinator.state).toHaveBeenCalledOnce();
  });
});
