// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProjectRegistryError,
  emptyProjectRegistry,
  normalizeProjectPath,
  parseProjectRegistry,
  readProjectRegistry,
  reconcileProject,
  updateProjectRegistry,
} from "./project-registry";

const tempRoots: string[] = [];
const PROJECT_ONE = "11111111-1111-4111-8111-111111111111";
const PROJECT_TWO = "22222222-2222-4222-8222-222222222222";

async function tempRegistryPath(): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-registry-"));
  tempRoots.push(root);
  return path.join(root, "projects.json");
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("project registry contract", () => {
  it("rejects project ids that are not UUIDs", () => {
    expect(() =>
      parseProjectRegistry({
        schemaVersion: 1,
        updatedAt: "2026-07-11T00:00:00.000Z",
        projects: {
          "project-1": {
            id: "project-1",
            rootPath: "C:\\work",
            displayName: null,
            sources: ["manual"],
            providerRefs: { claude: [], codex: [] },
            status: null,
            memo: "",
            tracks: [],
            hidden: false,
            order: null,
            createdAt: "2026-07-11T00:00:00.000Z",
            updatedAt: "2026-07-11T00:00:00.000Z",
          },
        },
      }),
    ).toThrow(/UUID/i);
  });

  it("rejects unsupported schemas and project keys that do not match their ids", () => {
    expect(() => parseProjectRegistry({ schemaVersion: 2, updatedAt: "2026-07-11T00:00:00.000Z", projects: {} })).toThrow(
      ProjectRegistryError,
    );

    expect(() =>
      parseProjectRegistry({
        schemaVersion: 1,
        updatedAt: "2026-07-11T00:00:00.000Z",
        projects: {
          [PROJECT_ONE]: {
            id: PROJECT_TWO,
            rootPath: "C:\\work",
            displayName: null,
            sources: ["manual"],
            providerRefs: { claude: [], codex: [] },
            status: null,
            memo: "",
            tracks: [],
            hidden: false,
            order: null,
            createdAt: "2026-07-11T00:00:00.000Z",
            updatedAt: "2026-07-11T00:00:00.000Z",
          },
        },
      }),
    ).toThrow(/project key/i);
  });

  it("normalizes Windows paths for case-insensitive reconciliation", () => {
    expect(normalizeProjectPath("C:/Work/Example/", "win32")).toBe("c:\\work\\example");
    expect(normalizeProjectPath("/srv/Work/Example/", "linux")).toBe("/srv/Work/Example");
  });

  it("reuses a stable id and merges provider discovery for the same path", () => {
    const now = "2026-07-11T01:00:00.000Z";
    const initial = emptyProjectRegistry("2026-07-11T00:00:00.000Z");
    const withManual = reconcileProject(
      initial,
      { rootPath: "C:\\Work\\Example", source: "manual" },
      { now, idFactory: () => PROJECT_ONE, platform: "win32" },
    );
    const discovered = reconcileProject(
      withManual,
      { rootPath: "c:/work/example/", source: "codex", providerRef: "codex:C--work-example" },
      { now: "2026-07-11T02:00:00.000Z", idFactory: () => PROJECT_TWO, platform: "win32" },
    );

    expect(Object.keys(discovered.projects)).toEqual([PROJECT_ONE]);
    expect(discovered.projects[PROJECT_ONE]).toMatchObject({
      sources: ["manual", "codex"],
      providerRefs: { claude: [], codex: ["codex:C--work-example"] },
    });
  });

  it("accepts blank track titles and item text while an editor is creating them", () => {
    const registry = emptyProjectRegistry("2026-07-11T00:00:00.000Z");
    registry.projects[PROJECT_ONE] = {
      id: PROJECT_ONE,
      rootPath: "C:\\Work",
      displayName: null,
      sources: ["manual"],
      providerRefs: { claude: [], codex: [] },
      status: null,
      memo: "",
      tracks: [{ id: "track-1", title: "", items: [{ id: "item-1", text: "", done: false }] }],
      hidden: false,
      order: null,
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
    };

    expect(parseProjectRegistry(registry).projects[PROJECT_ONE].tracks[0]).toEqual(registry.projects[PROJECT_ONE].tracks[0]);
  });
});

describe("project registry storage", () => {
  it("falls back to a valid backup and marks a corrupt primary read-only", async () => {
    const registryPath = await tempRegistryPath();
    const backup = emptyProjectRegistry("2026-07-11T00:00:00.000Z");
    await fs.writeFile(registryPath, "{broken", "utf8");
    await fs.writeFile(`${registryPath}.bak`, JSON.stringify(backup), "utf8");

    const snapshot = await readProjectRegistry({ registryPath });

    expect(snapshot.source).toBe("backup");
    expect(snapshot.writable).toBe(false);
    expect(snapshot.registry).toEqual(backup);
  });

  it("serializes concurrent updates without dropping either project", async () => {
    const registryPath = await tempRegistryPath();
    const addProject = (id: string, rootPath: string) =>
      updateProjectRegistry(
        (registry) =>
          reconcileProject(
            registry,
            { rootPath, source: "manual" },
            {
              now: `2026-07-11T00:00:0${id}.000Z`,
              idFactory: () => (id === "1" ? PROJECT_ONE : PROJECT_TWO),
              platform: "win32",
            },
          ),
        { registryPath, lockRetryMs: 2_000 },
      );

    await Promise.all([addProject("1", "C:\\One"), addProject("2", "C:\\Two")]);

    const snapshot = await readProjectRegistry({ registryPath });
    expect(Object.keys(snapshot.registry.projects).sort()).toEqual([PROJECT_ONE, PROJECT_TWO]);
    expect(snapshot.source).toBe("primary");
    expect(snapshot.writable).toBe(true);
  });
});
