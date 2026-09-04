// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProjectTagsRegistryError,
  parseProjectTags,
  pruneProjectTags,
  readProjectTags,
  setProjectTags,
} from "./project-tags-registry";

const tempRoots: string[] = [];

async function tempWorkspace(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), `mcw-${name}-`));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("project tags registry storage", () => {
  it("없는 파일이면 emptyProjectTags 모양으로 시작한다", async () => {
    const workspace = await tempWorkspace("tags-empty");
    const registryPath = path.join(workspace, "project-tags.json");
    expect(await readProjectTags({ registryPath })).toMatchObject({ schemaVersion: 1, tags: {} });
  });

  it("setProjectTags 후 readProjectTags로 왕복한다", async () => {
    const workspace = await tempWorkspace("tags-roundtrip");
    const registryPath = path.join(workspace, "project-tags.json");
    const options = { registryPath, now: () => "2026-09-03T12:00:00.000Z" };
    const written = await setProjectTags("wp-a", ["개인", "AI"], options);
    expect(written.tags["wp-a"]).toEqual(["개인", "AI"]);
    expect(await readProjectTags(options)).toEqual(written);
  });
});

describe("parseProjectTags", () => {
  it("모르는 최상위 키는 ProjectTagsRegistryError다", () => {
    expect(() =>
      parseProjectTags({ schemaVersion: 1, updatedAt: "2026-09-03T00:00:00.000Z", tags: {}, extra: 1 }),
    ).toThrow(ProjectTagsRegistryError);
  });

  it("schemaVersion: 2를 거부한다", () => {
    expect(() =>
      parseProjectTags({ schemaVersion: 2, updatedAt: "2026-09-03T00:00:00.000Z", tags: {} }),
    ).toThrow(ProjectTagsRegistryError);
  });

  it("손편집 값이 정규화되어 읽힌다", () => {
    const parsed = parseProjectTags({
      schemaVersion: 1,
      updatedAt: "2026-09-03T00:00:00.000Z",
      tags: { "wp-a": [" 연구 ", "연구", ""] },
    });
    expect(parsed.tags["wp-a"]).toEqual(["연구"]);
  });

  it("빈 키를 거부한다", () => {
    expect(() =>
      parseProjectTags({ schemaVersion: 1, updatedAt: "2026-09-03T00:00:00.000Z", tags: { "": ["x"] } }),
    ).toThrow(ProjectTagsRegistryError);
  });
});

describe("setProjectTags / pruneProjectTags", () => {
  it('setProjectTags("wp", [" ", ""])가 tags.wp = [] 행을 남긴다', async () => {
    const workspace = await tempWorkspace("tags-empty-row");
    const registryPath = path.join(workspace, "project-tags.json");
    const written = await setProjectTags("wp", [" ", ""], { registryPath });
    expect(written.tags).toHaveProperty("wp");
    expect(written.tags.wp).toEqual([]);
  });

  it("pruneProjectTags가 다른 행을 지우고, 지울 게 없으면 updatedAt이 그대로다", async () => {
    const workspace = await tempWorkspace("tags-prune");
    const registryPath = path.join(workspace, "project-tags.json");
    await setProjectTags("wp-keep", ["개인"], { registryPath, now: () => "2026-09-03T11:00:00.000Z" });
    await setProjectTags("wp-drop", ["연구"], { registryPath, now: () => "2026-09-03T12:00:00.000Z" });

    const pruned = await pruneProjectTags(new Set(["wp-keep"]), {
      registryPath,
      now: () => "2026-09-03T13:00:00.000Z",
    });
    expect(pruned.tags).toEqual({ "wp-keep": ["개인"] });
    expect(pruned.updatedAt).toBe("2026-09-03T13:00:00.000Z");

    // 지울 게 없으면 잠금도 쓰기도 하지 않는다 — updatedAt이 이전 값 그대로다.
    const noop = await pruneProjectTags(new Set(["wp-keep"]), {
      registryPath,
      now: () => "2026-09-03T14:00:00.000Z",
    });
    expect(noop.updatedAt).toBe("2026-09-03T13:00:00.000Z");
  });
});

describe("backup fallback", () => {
  it("깨진 primary에 정상 .bak이 있으면 .bak 내용을 읽는다", async () => {
    const workspace = await tempWorkspace("tags-bak");
    const registryPath = path.join(workspace, "project-tags.json");
    const options = { registryPath, now: () => "2026-09-03T12:00:00.000Z" };
    await setProjectTags("wp-a", ["개인"], options);
    // 두 번째 쓰기가 방금 파싱에 성공한 첫 쓰기 결과를 .bak으로 복사한다.
    await setProjectTags("wp-a", ["개인", "AI"], options);
    await fs.writeFile(registryPath, "{", "utf8");
    const read = await readProjectTags(options);
    expect(read.tags["wp-a"]).toEqual(["개인"]);
  });
});
