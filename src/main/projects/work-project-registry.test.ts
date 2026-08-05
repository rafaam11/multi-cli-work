// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkProjectRegistryV1 } from "../../shared/work-project-types";
import {
  emptyWorkProjectRegistry,
  parseWorkProjectRegistry,
  readWorkProjectRegistry,
  updateWorkProjectRegistry,
} from "./work-project-registry";

const tempRoots: string[] = [];
const WORK_PROJECT_IDS = {
  first: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  second: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
} as const;
const PROJECT_IDS = {
  repo: "11111111-1111-4111-8111-111111111111",
  docs: "22222222-2222-4222-8222-222222222222",
} as const;

async function tempWorkspace(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), `mcw-${name}-`));
  tempRoots.push(root);
  return root;
}

function sampleRegistry(): WorkProjectRegistryV1 {
  return {
    schemaVersion: 1,
    updatedAt: "2026-08-01T00:00:00.000Z",
    teamsSyncRoot: null,
    workProjects: {
      [WORK_PROJECT_IDS.first]: {
        id: WORK_PROJECT_IDS.first,
        name: "스마트팩토리 과제",
        category: "정부지원과제",
        status: "진행중",
        memo: "",
        notionLinks: [{ label: "채널", url: "https://notion.so/example" }],
        localFolders: [{ label: "자료", path: "D:\\Work\\자료" }],
        members: [
          { projectId: PROJECT_IDS.repo, role: "repo" },
          { projectId: PROJECT_IDS.docs, role: "docs" },
        ],
        order: 0,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    },
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("parseWorkProjectRegistry", () => {
  it("accepts a valid registry and canonicalizes timestamps", () => {
    const registry = sampleRegistry();
    registry.updatedAt = "2026-08-01T09:00:00+09:00";
    const parsed = parseWorkProjectRegistry(registry);
    expect(parsed.updatedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(parsed.workProjects[WORK_PROJECT_IDS.first].members).toHaveLength(2);
  });

  it("rejects unknown fields on the registry and on work projects", () => {
    expect(() => parseWorkProjectRegistry({ ...sampleRegistry(), extra: true })).toThrow(/unknown fields: extra/);
    const registry = sampleRegistry();
    Object.assign(registry.workProjects[WORK_PROJECT_IDS.first], { teamsPath: "C:\\Teams" });
    expect(() => parseWorkProjectRegistry(registry)).toThrow(/unknown fields: teamsPath/);
  });

  it("rejects duplicate members within a work project", () => {
    const registry = sampleRegistry();
    registry.workProjects[WORK_PROJECT_IDS.first].members = [
      { projectId: PROJECT_IDS.repo, role: "repo" },
      { projectId: PROJECT_IDS.repo, role: "docs" },
    ];
    expect(() => parseWorkProjectRegistry(registry)).toThrow(/duplicate projectIds/);
  });

  it("rejects a folder claimed by two work projects", () => {
    const registry = sampleRegistry();
    registry.workProjects[WORK_PROJECT_IDS.second] = {
      ...registry.workProjects[WORK_PROJECT_IDS.first],
      id: WORK_PROJECT_IDS.second,
      members: [{ projectId: PROJECT_IDS.repo, role: "repo" }],
    };
    expect(() => parseWorkProjectRegistry(registry)).toThrow(/both claim project/);
  });

  it("rejects invalid role, status, notionLinks and order values", () => {
    const withMember = (role: string) => {
      const registry = sampleRegistry();
      registry.workProjects[WORK_PROJECT_IDS.first].members = [{ projectId: PROJECT_IDS.repo, role: role as never }];
      return registry;
    };
    expect(() => parseWorkProjectRegistry(withMember("teams"))).toThrow(/role is invalid/);
    const badStatus = sampleRegistry();
    badStatus.workProjects[WORK_PROJECT_IDS.first].status = "완성" as never;
    expect(() => parseWorkProjectRegistry(badStatus)).toThrow(/status is invalid/);
    const withLinks = (links: unknown) => {
      const registry = sampleRegistry();
      registry.workProjects[WORK_PROJECT_IDS.first].notionLinks = links as never;
      return registry;
    };
    expect(() => parseWorkProjectRegistry(withLinks([{ label: "", url: "https://x" }]))).toThrow(/label/);
    expect(() => parseWorkProjectRegistry(withLinks([{ label: "채널" }]))).toThrow(/url/);
    expect(() => parseWorkProjectRegistry(withLinks([{ label: "채널", url: "https://x", kind: "channel" }]))).toThrow(
      /unknown fields: kind/,
    );
    const badOrder = sampleRegistry();
    badOrder.workProjects[WORK_PROJECT_IDS.first].order = -1;
    expect(() => parseWorkProjectRegistry(badOrder)).toThrow(/order/);
  });

  it("promotes a legacy notionUrl to a single labeled link and drops the old key on write", async () => {
    const registry = sampleRegistry() as unknown as Record<string, Record<string, Record<string, unknown>>>;
    const legacy = registry.workProjects[WORK_PROJECT_IDS.first];
    delete legacy.notionLinks;
    legacy.notionUrl = "https://notion.so/legacy";

    const parsed = parseWorkProjectRegistry(registry);
    expect(parsed.workProjects[WORK_PROJECT_IDS.first].notionLinks).toEqual([
      { label: "노션", url: "https://notion.so/legacy" },
    ]);
    expect(parsed.workProjects[WORK_PROJECT_IDS.first]).not.toHaveProperty("notionUrl");

    // A legacy file heals itself on the first write: only notionLinks reaches disk.
    const workspace = await tempWorkspace("wp-legacy");
    const registryPath = path.join(workspace, "work-projects.json");
    await updateWorkProjectRegistry(() => parsed, { registryPath });
    const raw = await fs.readFile(registryPath, "utf8");
    expect(raw).toContain("notionLinks");
    expect(raw).not.toContain("notionUrl");

    // notionLinks wins when a hand-edited file carries both keys.
    legacy.notionLinks = [{ label: "채널", url: "https://notion.so/channel" }];
    expect(parseWorkProjectRegistry(registry).workProjects[WORK_PROJECT_IDS.first].notionLinks).toEqual([
      { label: "채널", url: "https://notion.so/channel" },
    ]);
  });

  it("reads local folders, defaulting to an empty list, and rejects malformed rows", () => {
    expect(parseWorkProjectRegistry(sampleRegistry()).workProjects[WORK_PROJECT_IDS.first].localFolders).toEqual([
      { label: "자료", path: "D:\\Work\\자료" },
    ]);

    // Files written before local folders existed simply have no key, and had none.
    const legacy = sampleRegistry() as unknown as Record<string, Record<string, Record<string, unknown>>>;
    delete legacy.workProjects[WORK_PROJECT_IDS.first].localFolders;
    expect(parseWorkProjectRegistry(legacy).workProjects[WORK_PROJECT_IDS.first].localFolders).toEqual([]);

    const withFolders = (folders: unknown) => {
      const registry = sampleRegistry();
      registry.workProjects[WORK_PROJECT_IDS.first].localFolders = folders as never;
      return registry;
    };
    expect(() => parseWorkProjectRegistry(withFolders("D:\\Work"))).toThrow(/localFolders must be an array/);
    expect(() => parseWorkProjectRegistry(withFolders([{ label: "자료", path: "" }]))).toThrow(/path/);
    expect(() => parseWorkProjectRegistry(withFolders([{ path: "D:\\Work" }]))).toThrow(/label/);
    expect(() => parseWorkProjectRegistry(withFolders([{ label: "자료", path: "D:\\Work", kind: "ref" }]))).toThrow(
      /unknown fields: kind/,
    );
  });

  it("rejects a key that does not match the work project id", () => {
    const registry = sampleRegistry();
    registry.workProjects[WORK_PROJECT_IDS.second] = registry.workProjects[WORK_PROJECT_IDS.first];
    delete registry.workProjects[WORK_PROJECT_IDS.first];
    expect(() => parseWorkProjectRegistry(registry)).toThrow(/does not match/);
  });
});

describe("work project registry storage", () => {
  it("starts empty when no file exists and round-trips through update", async () => {
    const workspace = await tempWorkspace("wp-registry");
    const registryPath = path.join(workspace, "work-projects.json");
    expect((await readWorkProjectRegistry({ registryPath })).workProjects).toEqual({});

    const written = await updateWorkProjectRegistry(() => sampleRegistry(), { registryPath });
    expect(Object.keys(written.workProjects)).toEqual([WORK_PROJECT_IDS.first]);

    const readBack = await readWorkProjectRegistry({ registryPath });
    expect(readBack).toEqual(written);
    // projects.json is untouched by design — the store only ever writes its own file.
    const files = await fs.readdir(workspace);
    expect(files).toContain("work-projects.json");
    expect(files).not.toContain("projects.json");
  });

  it("provides an empty registry factory with canonical timestamps", () => {
    const empty = emptyWorkProjectRegistry("2026-08-01T00:00:00.000Z");
    expect(empty).toEqual({
      schemaVersion: 1,
      updatedAt: "2026-08-01T00:00:00.000Z",
      teamsSyncRoot: null,
      workProjects: {},
    });
  });

  it("reads an omitted teamsSyncRoot as null and rejects empty strings", () => {
    const withoutRoot = sampleRegistry() as unknown as Record<string, unknown>;
    delete withoutRoot.teamsSyncRoot;
    expect(parseWorkProjectRegistry(withoutRoot).teamsSyncRoot).toBeNull();
    expect(parseWorkProjectRegistry({ ...sampleRegistry(), teamsSyncRoot: "C:\\Teams" }).teamsSyncRoot).toBe("C:\\Teams");
    expect(() => parseWorkProjectRegistry({ ...sampleRegistry(), teamsSyncRoot: "" })).toThrow(/teamsSyncRoot/);
  });
});
