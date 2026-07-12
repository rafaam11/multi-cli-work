// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectRegistryV1 } from "../../shared/project-types";
import {
  PROJECT_REGISTRY_PATH,
  ProjectRegistryError,
  emptyProjectRegistry,
  normalizeProjectPath,
  parseProjectRegistry,
  readProjectRegistry,
  removeProjectFromRegistry,
  restoreProjectRegistryFromBackup,
  updateProjectRegistry,
  upsertManualProject,
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

  it("stores the registry outside the Harness Manager directory", () => {
    expect(PROJECT_REGISTRY_PATH).toContain(`${path.sep}.multi-cli-work${path.sep}`);
    expect(PROJECT_REGISTRY_PATH).not.toContain("harness-manager");
  });

  it("reuses the existing project when the same folder is opened again", () => {
    const initial = upsertManualProject(
      emptyProjectRegistry("2026-07-11T00:00:00.000Z"),
      { rootPath: "C:\\Work\\Example", displayName: "Example" },
      { now: "2026-07-11T01:00:00.000Z", idFactory: () => PROJECT_ONE, platform: "win32" },
    );
    const reopened = upsertManualProject(
      initial,
      { rootPath: "c:/work/example/", displayName: "example" },
      { now: "2026-07-11T02:00:00.000Z", idFactory: () => PROJECT_TWO, platform: "win32" },
    );

    expect(Object.keys(reopened.projects)).toEqual([PROJECT_ONE]);
    expect(reopened.projects[PROJECT_ONE]).toMatchObject({
      rootPath: "C:\\Work\\Example",
      displayName: "Example",
      sources: ["manual"],
      providerRefs: { claude: [], codex: [] },
      createdAt: "2026-07-11T01:00:00.000Z",
      updatedAt: "2026-07-11T02:00:00.000Z",
    });
  });

  it("removes a project without touching the others", () => {
    const withTwo = upsertManualProject(
      upsertManualProject(
        emptyProjectRegistry("2026-07-11T00:00:00.000Z"),
        { rootPath: "C:\\One" },
        { now: "2026-07-11T01:00:00.000Z", idFactory: () => PROJECT_ONE, platform: "win32" },
      ),
      { rootPath: "C:\\Two" },
      { now: "2026-07-11T01:00:00.000Z", idFactory: () => PROJECT_TWO, platform: "win32" },
    );

    const removed = removeProjectFromRegistry(withTwo, PROJECT_ONE, "2026-07-11T03:00:00.000Z");

    expect(Object.keys(removed.projects)).toEqual([PROJECT_TWO]);
    expect(removed.updatedAt).toBe("2026-07-11T03:00:00.000Z");
    expect(() => removeProjectFromRegistry(removed, PROJECT_ONE)).toThrow(ProjectRegistryError);
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

  it("rejects provider refs with the wrong shape or missing source membership", () => {
    const registry = emptyProjectRegistry("2026-07-11T00:00:00.000Z");
    registry.projects[PROJECT_ONE] = {
      id: PROJECT_ONE,
      rootPath: "C:\\Work",
      displayName: null,
      sources: ["manual"],
      providerRefs: { claude: ["claude:C--Work"], codex: ["C--Work"] },
      status: null,
      memo: "",
      tracks: [],
      hidden: false,
      order: null,
      createdAt: registry.updatedAt,
      updatedAt: registry.updatedAt,
    };

    expect(() => parseProjectRegistry(registry)).toThrow(/provider ref|source/i);
  });

  it("rejects an empty sources array", () => {
    const registry = emptyProjectRegistry("2026-07-11T00:00:00.000Z");
    registry.projects[PROJECT_ONE] = {
      id: PROJECT_ONE,
      rootPath: "C:\\Work",
      displayName: null,
      sources: [],
      providerRefs: { claude: [], codex: [] },
      status: null,
      memo: "",
      tracks: [],
      hidden: false,
      order: null,
      createdAt: registry.updatedAt,
      updatedAt: registry.updatedAt,
    };

    expect(() => parseProjectRegistry(registry)).toThrow(ProjectRegistryError);
    expect(() => parseProjectRegistry(registry)).toThrow(/sources/i);
  });

  it("rejects duplicate entries within sources", () => {
    const registry = emptyProjectRegistry("2026-07-11T00:00:00.000Z");
    registry.projects[PROJECT_ONE] = {
      id: PROJECT_ONE,
      rootPath: "C:\\Work",
      displayName: null,
      sources: ["claude", "claude"],
      providerRefs: { claude: [], codex: [] },
      status: null,
      memo: "",
      tracks: [],
      hidden: false,
      order: null,
      createdAt: registry.updatedAt,
      updatedAt: registry.updatedAt,
    };

    expect(() => parseProjectRegistry(registry)).toThrow(ProjectRegistryError);
    expect(() => parseProjectRegistry(registry)).toThrow(/sources/i);
  });

  it("accepts valid sources arrays and preserves canonical order", () => {
    const registry = emptyProjectRegistry("2026-07-11T00:00:00.000Z");
    registry.projects[PROJECT_ONE] = {
      id: PROJECT_ONE,
      rootPath: "C:\\Work",
      displayName: null,
      sources: ["manual"],
      providerRefs: { claude: [], codex: [] },
      status: null,
      memo: "",
      tracks: [],
      hidden: false,
      order: null,
      createdAt: registry.updatedAt,
      updatedAt: registry.updatedAt,
    };
    registry.projects[PROJECT_TWO] = {
      id: PROJECT_TWO,
      rootPath: "C:\\Other",
      displayName: null,
      sources: ["codex", "claude"],
      providerRefs: { claude: [], codex: [] },
      status: null,
      memo: "",
      tracks: [],
      hidden: false,
      order: null,
      createdAt: registry.updatedAt,
      updatedAt: registry.updatedAt,
    };

    const parsed = parseProjectRegistry(registry);
    expect(parsed.projects[PROJECT_ONE].sources).toEqual(["manual"]);
    expect(parsed.projects[PROJECT_TWO].sources).toEqual(["claude", "codex"]);
  });

  it("rejects duplicate normalized roots and provider refs across UUIDs", () => {
    const registry = emptyProjectRegistry("2026-07-11T00:00:00.000Z");
    const common = {
      displayName: null,
      sources: ["codex" as const],
      providerRefs: { claude: [], codex: ["codex:C--Work"] },
      status: null,
      memo: "",
      tracks: [],
      hidden: false,
      order: null,
      createdAt: registry.updatedAt,
      updatedAt: registry.updatedAt,
    };
    registry.projects[PROJECT_ONE] = { ...common, id: PROJECT_ONE, rootPath: "C:\\Work" };
    registry.projects[PROJECT_TWO] = { ...common, id: PROJECT_TWO, rootPath: "c:/work/" };

    expect(() => parseProjectRegistry(registry)).toThrow(/duplicate/i);
  });

  it("keeps a renamed project's display name when the folder is opened again", () => {
    const renamed = upsertManualProject(
      emptyProjectRegistry("2026-07-11T00:00:00.000Z"),
      { rootPath: "C:\\Work", displayName: "My name" },
      { now: "2026-07-11T01:00:00.000Z", idFactory: () => PROJECT_ONE, platform: "win32" },
    );

    const reopened = upsertManualProject(
      renamed,
      { rootPath: "C:\\Work", displayName: "Work" },
      { now: "2026-07-11T02:00:00.000Z", platform: "win32" },
    );

    expect(reopened.projects[PROJECT_ONE].displayName).toBe("My name");
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

  it("prefers a valid backup over an empty registry when the primary is missing", async () => {
    const registryPath = await tempRegistryPath();
    const backup = emptyProjectRegistry("2026-07-11T00:00:00.000Z");
    await fs.writeFile(`${registryPath}.bak`, JSON.stringify(backup), "utf8");

    const snapshot = await readProjectRegistry({ registryPath });

    expect(snapshot).toMatchObject({ source: "backup", writable: false, registry: backup });
    expect(snapshot.warning).toMatch(/missing/i);
  });

  it("serializes concurrent updates without dropping either project", async () => {
    const registryPath = await tempRegistryPath();
    const addProject = (id: string, rootPath: string) =>
      updateProjectRegistry(
        (registry) =>
          upsertManualProject(
            registry,
            { rootPath },
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

describe("project registry timestamp normalization", () => {
  // Mirrors harness-manager's canonical-ISO round-trip check: milliseconds + "Z", no other offset form.
  const isCanonical = (value: string): boolean =>
    Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;

  const NON_CANONICAL_REGISTRY_UPDATED_AT = "2026-07-11T12:00:00Z";
  const NON_CANONICAL_MIGRATED_AT = "2026-07-11T21:00:00.000+09:00";
  const NON_CANONICAL_PROJECT_CREATED_AT = "2026-07-11T12:00:00Z";
  const NON_CANONICAL_PROJECT_UPDATED_AT = "2026-07-11T21:00:00.000+09:00";

  function nonCanonicalRegistryFixture(): ProjectRegistryV1 {
    const registry = emptyProjectRegistry(NON_CANONICAL_REGISTRY_UPDATED_AT);
    registry.migratedFromBoardAt = NON_CANONICAL_MIGRATED_AT;
    registry.projects[PROJECT_ONE] = {
      id: PROJECT_ONE,
      rootPath: "C:\\Work",
      displayName: null,
      sources: ["manual"],
      providerRefs: { claude: [], codex: [] },
      status: null,
      memo: "",
      tracks: [],
      hidden: false,
      order: null,
      createdAt: NON_CANONICAL_PROJECT_CREATED_AT,
      updatedAt: NON_CANONICAL_PROJECT_UPDATED_AT,
    };
    return registry;
  }

  it("normalizes non-canonical ISO timestamps to canonical form while preserving the instant", () => {
    const fixture = nonCanonicalRegistryFixture();
    const parsed = parseProjectRegistry(fixture);

    expect(isCanonical(parsed.updatedAt)).toBe(true);
    expect(isCanonical(parsed.migratedFromBoardAt!)).toBe(true);
    expect(isCanonical(parsed.projects[PROJECT_ONE].createdAt)).toBe(true);
    expect(isCanonical(parsed.projects[PROJECT_ONE].updatedAt)).toBe(true);

    expect(Date.parse(parsed.updatedAt)).toBe(Date.parse(fixture.updatedAt));
    expect(Date.parse(parsed.migratedFromBoardAt!)).toBe(Date.parse(fixture.migratedFromBoardAt!));
    expect(Date.parse(parsed.projects[PROJECT_ONE].createdAt)).toBe(Date.parse(fixture.projects[PROJECT_ONE].createdAt));
    expect(Date.parse(parsed.projects[PROJECT_ONE].updatedAt)).toBe(Date.parse(fixture.projects[PROJECT_ONE].updatedAt));
  });

  it("self-heals non-canonical timestamps on disk when the registry file is rewritten", async () => {
    const registryPath = await tempRegistryPath();
    const fixture = nonCanonicalRegistryFixture();
    await fs.writeFile(registryPath, JSON.stringify(fixture), "utf8");

    await updateProjectRegistry((registry) => registry, { registryPath });

    const onDisk = JSON.parse(await fs.readFile(registryPath, "utf8"));
    expect(isCanonical(onDisk.updatedAt)).toBe(true);
    expect(isCanonical(onDisk.migratedFromBoardAt)).toBe(true);
    expect(isCanonical(onDisk.projects[PROJECT_ONE].createdAt)).toBe(true);
    expect(isCanonical(onDisk.projects[PROJECT_ONE].updatedAt)).toBe(true);
  });

  it("still rejects timestamps that cannot be parsed at all", () => {
    const fixture = nonCanonicalRegistryFixture();
    fixture.updatedAt = "not-a-timestamp";
    expect(() => parseProjectRegistry(fixture)).toThrow(/ISO timestamp/i);
  });
});

describe("project registry backup restore", () => {
  function validRegistryJson(memo: string): string {
    return `${JSON.stringify({
      schemaVersion: 1,
      updatedAt: "2026-07-11T00:00:00.000Z",
      projects: {
        [PROJECT_ONE]: {
          id: PROJECT_ONE,
          rootPath: "C:\work\atlas",
          displayName: "Atlas",
          sources: ["manual"],
          providerRefs: { claude: [], codex: [] },
          status: null,
          memo,
          tracks: [],
          hidden: false,
          order: null,
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
        },
      },
    })}\n`;
  }

  it("restores a corrupt primary from a valid backup and becomes writable again", async () => {
    const registryPath = await tempRegistryPath();
    await fs.writeFile(registryPath, "{ not json", "utf8");
    await fs.writeFile(`${registryPath}.bak`, validRegistryJson("from backup"), "utf8");

    const restored = await restoreProjectRegistryFromBackup({ registryPath });

    expect(restored.projects[PROJECT_ONE].memo).toBe("from backup");
    const snapshot = await readProjectRegistry({ registryPath });
    expect(snapshot.source).toBe("primary");
    expect(snapshot.writable).toBe(true);
    expect(snapshot.registry.projects[PROJECT_ONE].memo).toBe("from backup");
  });

  it("never overwrites the valid backup with the corrupt primary during a restore", async () => {
    const registryPath = await tempRegistryPath();
    const backupJson = validRegistryJson("last good");
    await fs.writeFile(registryPath, "{ not json", "utf8");
    await fs.writeFile(`${registryPath}.bak`, backupJson, "utf8");

    await restoreProjectRegistryFromBackup({ registryPath });

    const backupOnDisk = JSON.parse(await fs.readFile(`${registryPath}.bak`, "utf8"));
    expect(backupOnDisk.projects[PROJECT_ONE].memo).toBe("last good");
  });

  it("fails clearly when the backup is missing or invalid", async () => {
    const registryPath = await tempRegistryPath();
    await fs.writeFile(registryPath, "{ not json", "utf8");

    await expect(restoreProjectRegistryFromBackup({ registryPath })).rejects.toThrow(ProjectRegistryError);

    await fs.writeFile(`${registryPath}.bak`, "also { not json", "utf8");
    await expect(restoreProjectRegistryFromBackup({ registryPath })).rejects.toThrow(ProjectRegistryError);
  });

  it("keeps backing up a valid primary before normal rewrites", async () => {
    const registryPath = await tempRegistryPath();
    await fs.writeFile(registryPath, validRegistryJson("first"), "utf8");

    await updateProjectRegistry(
      (registry) => ({
        ...registry,
        projects: {
          ...registry.projects,
          [PROJECT_ONE]: { ...registry.projects[PROJECT_ONE], memo: "second" },
        },
      }),
      { registryPath },
    );

    const backupOnDisk = JSON.parse(await fs.readFile(`${registryPath}.bak`, "utf8"));
    expect(backupOnDisk.projects[PROJECT_ONE].memo).toBe("first");
  });
});
