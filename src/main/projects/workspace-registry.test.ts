// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceRegistryV1 } from "../../shared/workspace-types";
import {
  addWorkspaceRoot,
  emptyWorkspaceRegistry,
  parseWorkspaceRegistry,
  readWorkspaceRegistry,
  removeWorkspaceRoot,
  setWorkspaceShellLinks,
  updateWorkspaceRegistry,
} from "./workspace-registry";

const tempRoots: string[] = [];
const WORK_PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function tempWorkspace(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), `mcw-${name}-`));
  tempRoots.push(root);
  return root;
}

function sampleRegistry(): WorkspaceRegistryV1 {
  return {
    schemaVersion: 1,
    updatedAt: "2026-08-30T00:00:00.000Z",
    roots: [{ work: "C:\\work", dev: "C:\\dev", data: "C:\\data", label: "work-root" }],
    shellLinks: [
      { workProjectId: WORK_PROJECT_ID, root: "C:\\work", channel: "O_SMCH", shell: "24_SMCH_VSP-1" },
    ],
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("parseWorkspaceRegistry", () => {
  it("accepts a valid registry and canonicalizes timestamps", () => {
    const registry = sampleRegistry();
    registry.updatedAt = "2026-08-30T09:00:00+09:00";
    const parsed = parseWorkspaceRegistry(registry);
    expect(parsed.updatedAt).toBe("2026-08-30T00:00:00.000Z");
    expect(parsed.roots).toEqual([{ work: "C:\\work", dev: "C:\\dev", data: "C:\\data", label: "work-root" }]);
  });

  it("rejects unknown fields on the registry, on roots and on links", () => {
    expect(() => parseWorkspaceRegistry({ ...sampleRegistry(), extra: true })).toThrow(/unknown fields: extra/);
    const withRootField = sampleRegistry();
    Object.assign(withRootField.roots[0], { alias: "x" });
    expect(() => parseWorkspaceRegistry(withRootField)).toThrow(/unknown fields: alias/);
    const withLinkField = sampleRegistry();
    Object.assign(withLinkField.shellLinks[0], { title: "x" });
    expect(() => parseWorkspaceRegistry(withLinkField)).toThrow(/unknown fields: title/);
  });

  it("rejects an unsupported schema version and a non-array roots field", () => {
    expect(() => parseWorkspaceRegistry({ ...sampleRegistry(), schemaVersion: 2 })).toThrow(/Unsupported/);
    expect(() => parseWorkspaceRegistry({ ...sampleRegistry(), roots: "C:\\work" })).toThrow(/roots must be an array/);
  });

  it("rejects duplicate roots by normalized path", () => {
    const registry = sampleRegistry();
    registry.roots.push({ work: "c:/work/", dev: "C:\\dev", data: "C:\\data", label: "같은 폴더" });
    expect(() => parseWorkspaceRegistry(registry)).toThrow(/duplicate roots/);
  });

  it("rejects a shell linked twice and a work project linked twice", () => {
    const twoShells = sampleRegistry();
    twoShells.shellLinks.push({ ...twoShells.shellLinks[0], shell: "25_SMCH_FOAA-1" });
    expect(() => parseWorkspaceRegistry(twoShells)).toThrow(/work project more than once/);

    const twoProjects = sampleRegistry();
    twoProjects.shellLinks.push({
      ...twoProjects.shellLinks[0],
      workProjectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    expect(() => parseWorkspaceRegistry(twoProjects)).toThrow(/shell more than once/);
  });

  it("reads a hand-written file without shellLinks as having none", () => {
    const legacy = sampleRegistry() as unknown as Record<string, unknown>;
    delete legacy.shellLinks;
    expect(parseWorkspaceRegistry(legacy).shellLinks).toEqual([]);
  });

  it("falls back to the sibling convention when a hand-written root omits dev/data", () => {
    const registry = sampleRegistry() as unknown as { roots: Array<Record<string, unknown>> };
    delete registry.roots[0].dev;
    delete registry.roots[0].data;
    const parsed = parseWorkspaceRegistry(registry);
    expect(parsed.roots[0].dev).toBe(path.win32.join("C:\\", "dev"));
    expect(parsed.roots[0].data).toBe(path.win32.join("C:\\", "data"));
  });

  it("allows an empty label but not an empty path on any of the three roots", () => {
    const blankLabel = sampleRegistry();
    blankLabel.roots[0].label = "";
    expect(parseWorkspaceRegistry(blankLabel).roots[0].label).toBe("");

    for (const key of ["work", "dev", "data"] as const) {
      const blank = sampleRegistry();
      blank.roots[0][key] = "";
      expect(() => parseWorkspaceRegistry(blank)).toThrow(new RegExp(`${key} must be a non-empty string`));
    }
  });
});

describe("workspace registry storage", () => {
  it("starts empty when no file exists and round-trips through update", async () => {
    const workspace = await tempWorkspace("ws-registry");
    const registryPath = path.join(workspace, "workspace.json");
    expect(await readWorkspaceRegistry({ registryPath })).toMatchObject({ roots: [], shellLinks: [] });

    const written = await updateWorkspaceRegistry(() => sampleRegistry(), { registryPath });
    expect(written.roots).toHaveLength(1);
    expect(await readWorkspaceRegistry({ registryPath })).toEqual(written);

    // The other registries are never touched — this store only ever writes its own file.
    const files = await fs.readdir(workspace);
    expect(files).toContain("workspace.json");
    expect(files).not.toContain("projects.json");
    expect(files).not.toContain("work-projects.json");
    expect(files).not.toContain("state.json");
  });

  it("refreshes the backup only from a primary that parses", async () => {
    const workspace = await tempWorkspace("ws-registry-bak");
    const registryPath = path.join(workspace, "workspace.json");
    await updateWorkspaceRegistry(() => sampleRegistry(), { registryPath });
    await updateWorkspaceRegistry(
      (registry) => ({
        ...registry,
        roots: [...registry.roots, { work: "D:\\work", dev: "D:\\dev", data: "D:\\data", label: "lab" }],
      }),
      { registryPath },
    );
    const backup = parseWorkspaceRegistry(JSON.parse(await fs.readFile(`${registryPath}.bak`, "utf8")));
    expect(backup.roots).toHaveLength(1);

    await fs.writeFile(registryPath, "{ not json", "utf8");
    // A corrupt primary falls back to the backup read-only rather than losing the list.
    expect((await readWorkspaceRegistry({ registryPath })).roots).toHaveLength(1);
    await expect(updateWorkspaceRegistry((registry) => registry, { registryPath })).rejects.toThrow(/invalid/);
  });

  it("provides an empty registry factory with canonical timestamps", () => {
    expect(emptyWorkspaceRegistry("2026-08-30T00:00:00.000Z")).toEqual({
      schemaVersion: 1,
      updatedAt: "2026-08-30T00:00:00.000Z",
      roots: [],
      shellLinks: [],
    });
  });
});

describe("root mutations", () => {
  const options = (registryPath: string) => ({
    registryPath,
    platform: "win32" as NodeJS.Platform,
    now: () => "2026-08-30T12:00:00.000Z",
  });

  it("adds a root, defaulting the label to the folder name", async () => {
    const workspace = await tempWorkspace("ws-add");
    const registryPath = path.join(workspace, "workspace.json");
    const registry = await addWorkspaceRoot("C:\\work", null, {}, options(registryPath));
    // dev·data를 주지 않으면 관례값(형제 폴더)을 적어 둔다.
    expect(registry.roots).toEqual([{ work: "C:\\work", dev: "C:\\dev", data: "C:\\data", label: "work" }]);
    expect(registry.updatedAt).toBe("2026-08-30T12:00:00.000Z");
  });

  it("re-adding the same folder relabels it instead of duplicating the row", async () => {
    const workspace = await tempWorkspace("ws-readd");
    const registryPath = path.join(workspace, "workspace.json");
    await addWorkspaceRoot("C:\\work", "work-root", { dev: "C:\\dev", data: "C:\\data" }, options(registryPath));
    const registry = await addWorkspaceRoot(
      "c:/work/",
      "연구실",
      { dev: "D:\\dev", data: "D:\\data" },
      options(registryPath),
    );
    // 줄을 늘리지 않고 라벨과 dev·data 위치만 갱신한다 — 그 사이 배치가 옮겨졌을 수 있다.
    expect(registry.roots).toEqual([{ work: "C:\\work", dev: "D:\\dev", data: "D:\\data", label: "연구실" }]);
  });

  it("removes a root together with its shell links, leaving other roots alone", async () => {
    const workspace = await tempWorkspace("ws-remove");
    const registryPath = path.join(workspace, "workspace.json");
    await updateWorkspaceRegistry(
      () => ({
        ...sampleRegistry(),
        roots: [
          { work: "C:\\work", dev: "C:\\dev", data: "C:\\data", label: "work-root" },
          { work: "D:\\work", dev: "D:\\dev", data: "D:\\data", label: "lab" },
        ],
      }),
      { registryPath },
    );
    const registry = await removeWorkspaceRoot("C:\\WORK", options(registryPath));
    expect(registry.roots).toEqual([{ work: "D:\\work", dev: "D:\\dev", data: "D:\\data", label: "lab" }]);
    expect(registry.shellLinks).toEqual([]);
  });

  it("rejects removing a root that is not registered", async () => {
    const workspace = await tempWorkspace("ws-remove-missing");
    const registryPath = path.join(workspace, "workspace.json");
    await expect(removeWorkspaceRoot("C:\\nope", options(registryPath))).rejects.toThrow(/not registered/);
  });

  it("replaces the shell links wholesale", async () => {
    const workspace = await tempWorkspace("ws-links");
    const registryPath = path.join(workspace, "workspace.json");
    await addWorkspaceRoot("C:\\work", "work-root", {}, options(registryPath));
    const links = [
      { workProjectId: WORK_PROJECT_ID, root: "C:\\work", channel: "O_SMCH", shell: "24_SMCH_VSP-1" },
    ];
    expect((await setWorkspaceShellLinks(links, options(registryPath))).shellLinks).toEqual(links);
    expect((await setWorkspaceShellLinks([], options(registryPath))).shellLinks).toEqual([]);
  });
});
