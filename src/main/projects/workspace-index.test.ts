// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceRegistryV1 } from "../../shared/workspace-types";
import { workspacePathKey } from "../../shared/workspace-path";
import { WorkspaceIndex, readDatasetPaths, resolveWorkspaceRoots } from "./workspace-index";

const tempRoots: string[] = [];
// 루트 밖 레포(external_paths) 픽스처 — 플랫폼 네이티브 절대경로. CI(ubuntu)에서는 "C:\\…"가 절대경로가 아니다.
const EXTERNAL_REPO = path.resolve(path.sep, "NeuroPilot", "neuropilot_develop");

async function tempWorkspace(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), `mcw-${name}-`));
  tempRoots.push(root);
  return root;
}

async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

/** mtime을 직접 세워 "생성물이 최신인가" 판정을 흔들림 없이 검사한다. */
async function touch(file: string, seconds: number): Promise<void> {
  await fs.utimes(file, new Date(seconds * 1000), new Date(seconds * 1000));
}

function shellClaude(fields: Record<string, string>): string {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n# 셸\n`;
}

async function fixture(name: string): Promise<string> {
  const root = await tempWorkspace(name);
  await writeFile(
    path.join(root, "O_SMCH", "24_SMCH_VSP-1", "CLAUDE.md"),
    shellClaude({
      title: "가상수술계획",
      channel: "O_SMCH",
      project: "24_SMCH_VSP-1",
      status: "active",
      repos: "[VSP_FastAPI, VSP_MQ_v2]",
      external_paths: "[]",
      data: "[DS-0001]",
    }),
  );
  await writeFile(
    path.join(root, "O_ATNC", "24_ATNC_NeuroPilot-1", "CLAUDE.md"),
    shellClaude({
      title: "ATNC NeuroPilot(rTMS 내비게이션)",
      channel: "O_ATNC",
      project: "24_ATNC_NeuroPilot-1",
      status: "active",
      repos: "[BrainHi]",
      // ws-path.mjs의 파서는 따옴표만 벗기므로 백슬래시가 둘로 남는다 — 정규화가 이걸 흡수해야 한다.
      external_paths: JSON.stringify([EXTERNAL_REPO]),
      data: "[]",
    }),
  );
  return root;
}

/**
 * 기본 픽스처는 dev·data를 work 안에 둔다 — 임시 폴더 하나로 세 루트를 다 만들 수 있어서다.
 * 실제 관례인 3형제 배치는 아래 "3형제 루트" describe가 따로 검사한다.
 */
function rootRecord(root: string, label = "work-root") {
  return { work: root, dev: path.join(root, "dev"), data: path.join(root, "data"), label };
}

function registryFor(root: string, label = "work-root"): WorkspaceRegistryV1 {
  return {
    schemaVersion: 1,
    updatedAt: "2026-08-30T00:00:00.000Z",
    roots: [rootRecord(root, label)],
    shellLinks: [],
  };
}

function registryOf(roots: WorkspaceRegistryV1["roots"]): WorkspaceRegistryV1 {
  return { schemaVersion: 1, updatedAt: "2026-08-30T00:00:00.000Z", roots, shellLinks: [] };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("WorkspaceIndex", () => {
  it("scans shell frontmatter and builds the repo reverse index", async () => {
    const root = await fixture("index-scan");
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));

    expect(snapshot.shells.map((shell) => shell.ref).sort()).toEqual([
      "O_ATNC/24_ATNC_NeuroPilot-1",
      "O_SMCH/24_SMCH_VSP-1",
    ]);
    const vsp = snapshot.shells.find((shell) => shell.channel === "O_SMCH")!;
    expect(vsp).toMatchObject({
      title: "가상수술계획",
      status: "active",
      channelLetter: "O",
      channelLabel: "용역",
      shell: "24_SMCH_VSP-1",
      repos: ["VSP_FastAPI", "VSP_MQ_v2"],
      data: ["DS-0001"],
      path: path.join(root, "O_SMCH", "24_SMCH_VSP-1"),
    });

    expect(snapshot.repoOwners[workspacePathKey(path.join(root, "dev", "VSP_FastAPI"))]).toBe(
      "O_SMCH/24_SMCH_VSP-1",
    );
    // 휴면 위치로 옮겨도 소속은 그대로다.
    expect(snapshot.repoOwners[workspacePathKey(path.join(root, "dev", "_archive", "BrainHi"))]).toBe(
      "O_ATNC/24_ATNC_NeuroPilot-1",
    );
    // 루트 밖 레포도 셸을 안다 — 겹백슬래시가 접힌 뒤에.
    expect(snapshot.repoOwners[workspacePathKey(EXTERNAL_REPO)]).toBe(
      "O_ATNC/24_ATNC_NeuroPilot-1",
    );
  });

  it("falls back to the folder name when the shell has no title", async () => {
    const root = await tempWorkspace("index-untitled");
    await writeFile(path.join(root, "P_Personal", "26_Personal_Career-1", "CLAUDE.md"), "# 제목만\n");
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    expect(snapshot.shells[0]).toMatchObject({ title: "26_Personal_Career-1", status: null, repos: [] });
  });

  it("keeps the original slug for shells parked under Z_Archive", async () => {
    const root = await tempWorkspace("index-archive");
    await writeFile(
      path.join(root, "Z_Archive", "23_SMCH_DtNavi-1", "CLAUDE.md"),
      shellClaude({ title: "휴면 셸", channel: "Z_Archive", channel_origin: "O_SMCH" }),
    );
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    expect(snapshot.shells.map((shell) => shell.ref)).toEqual(["Z_Archive/23_SMCH_DtNavi-1"]);
    expect(snapshot.warnings).toEqual([]);
  });

  it("warns about a malformed shell name and a shell with no CLAUDE.md", async () => {
    const root = await tempWorkspace("index-warn");
    await fs.mkdir(path.join(root, "O_SMCH", "vsp"), { recursive: true });
    await fs.mkdir(path.join(root, "O_SMCH", "24_SMCH_Empty-1"), { recursive: true });
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    expect(snapshot.shells).toEqual([]);
    expect(snapshot.warnings).toEqual([
      "[shell-claude] O_SMCH/24_SMCH_Empty-1: CLAUDE.md 없음",
      "[shell-name] O_SMCH/vsp: 셸 이름 규약 위반(YY_<채널슬러그>_<Topic>-<n>)",
    ]);
  });

  it("ignores folders that are not channels", async () => {
    const root = await tempWorkspace("index-non-channel");
    await writeFile(path.join(root, "dev", "VSP_FastAPI", "CLAUDE.md"), "# 레포\n");
    await writeFile(path.join(root, "_templates", "shell", "CLAUDE.md"), "# 템플릿\n");
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    expect(snapshot.shells).toEqual([]);
  });

  it("prefers a fresh .ws-index.json over reading every CLAUDE.md", async () => {
    const root = await fixture("index-prefer");
    await touch(path.join(root, "O_SMCH", "24_SMCH_VSP-1", "CLAUDE.md"), 1_000);
    await touch(path.join(root, "O_ATNC", "24_ATNC_NeuroPilot-1", "CLAUDE.md"), 1_000);
    await writeFile(
      path.join(root, ".ws-index.json"),
      JSON.stringify({
        generatedAt: "2026-08-30T00:00:00.000Z",
        shells: [
          { ref: "O_SMCH/24_SMCH_VSP-1", channel: "O_SMCH", name: "24_SMCH_VSP-1", title: "생성물이 준 이름", repos: ["VSP_FastAPI"], external_paths: [], data: [] },
          { ref: "O_ATNC/24_ATNC_NeuroPilot-1", channel: "O_ATNC", name: "24_ATNC_NeuroPilot-1", title: "NeuroPilot", repos: [], external_paths: [], data: [] },
        ],
      }),
    );
    await touch(path.join(root, ".ws-index.json"), 2_000);

    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    expect(snapshot.shells.find((shell) => shell.channel === "O_SMCH")?.title).toBe("생성물이 준 이름");
    // 경로는 생성한 PC의 것을 믿지 않고 이 PC의 루트에서 다시 만든다.
    expect(snapshot.shells.find((shell) => shell.channel === "O_SMCH")?.path).toBe(
      path.join(root, "O_SMCH", "24_SMCH_VSP-1"),
    );
  });

  it("re-scans when .ws-index.json is older than a shell or lists a different set", async () => {
    const root = await fixture("index-stale");
    const claude = path.join(root, "O_SMCH", "24_SMCH_VSP-1", "CLAUDE.md");
    await writeFile(
      path.join(root, ".ws-index.json"),
      JSON.stringify({ shells: [{ channel: "O_SMCH", name: "24_SMCH_VSP-1", title: "낡은 이름", repos: [] }] }),
    );
    await touch(path.join(root, ".ws-index.json"), 1_000);
    await touch(claude, 2_000);

    const stale = await new WorkspaceIndex().snapshot(registryFor(root));
    expect(stale.shells.find((shell) => shell.channel === "O_SMCH")?.title).toBe("가상수술계획");

    // 생성물이 최신이어도 셸 수가 맞지 않으면 믿지 않는다(위 파일은 셸 하나만 담고 있다).
    await touch(claude, 500);
    await touch(path.join(root, "O_ATNC", "24_ATNC_NeuroPilot-1", "CLAUDE.md"), 500);
    const mismatched = await new WorkspaceIndex().snapshot(registryFor(root));
    expect(mismatched.shells).toHaveLength(2);
    expect(mismatched.shells.find((shell) => shell.channel === "O_SMCH")?.title).toBe("가상수술계획");
  });

  it("caches a root until one of its CLAUDE.md files changes", async () => {
    const root = await fixture("index-cache");
    const index = new WorkspaceIndex();
    const claude = path.join(root, "O_SMCH", "24_SMCH_VSP-1", "CLAUDE.md");
    const titleOf = async () =>
      (await index.snapshot(registryFor(root))).shells.find((shell) => shell.channel === "O_SMCH")?.title;
    await touch(claude, 1_000);
    expect(await titleOf()).toBe("가상수술계획");

    // 내용만 바꾸고 mtime을 되돌리면 캐시가 유지된다 — 판정이 mtime이라는 증거.
    await fs.writeFile(claude, shellClaude({ title: "새 이름", channel: "O_SMCH", repos: "[VSP_FastAPI]" }), "utf8");
    await touch(claude, 1_000);
    expect(await titleOf()).toBe("가상수술계획");

    await touch(claude, 9_000);
    expect(await titleOf()).toBe("새 이름");

    // invalidate는 mtime과 상관없이 다음 조회를 다시 읽게 한다.
    await fs.writeFile(claude, shellClaude({ title: "세 번째", channel: "O_SMCH" }), "utf8");
    await touch(claude, 9_000);
    index.invalidate(root);
    expect(await titleOf()).toBe("세 번째");
  });

  it("returns nothing for a root that does not exist, without throwing", async () => {
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(path.join("C:", "does", "not", "exist")));
    expect(snapshot.shells).toEqual([]);
    expect(snapshot.repoOwners).toEqual({});
  });

  it("merges several roots into one snapshot", async () => {
    const first = await fixture("index-multi-a");
    const second = await tempWorkspace("index-multi-b");
    await writeFile(
      path.join(second, "R_GeomCAS", "26_GeomCAS_Thesis-1", "CLAUDE.md"),
      shellClaude({ title: "논문", channel: "R_GeomCAS", repos: "[thesis]" }),
    );
    const snapshot = await new WorkspaceIndex().snapshot({
      ...registryFor(first),
      roots: [rootRecord(first, "개인PC"), rootRecord(second, "연구실PC")],
    });
    expect(snapshot.shells).toHaveLength(3);
    expect(snapshot.repoOwners[workspacePathKey(path.join(second, "dev", "thesis"))]).toBe(
      "R_GeomCAS/26_GeomCAS_Thesis-1",
    );
  });
});

describe("readDatasetPaths", () => {
  it("reads the DS-#### rows of data/index.md into absolute paths", async () => {
    const root = await tempWorkspace("dataset-registry");
    await writeFile(
      path.join(root, "data", "index.md"),
      [
        "---",
        "title: 데이터셋 레지스트리",
        "next_id: 3",
        "---",
        "| id | title | purpose | source | kind | sensitivity | path |",
        "|---|---|---|---|---|---|---|",
        "| DS-0001 | 교합연구 | patient | SMCH | raw | restricted | patient/26_SMCH_Occlusion-1 |",
        "| DS-0002 | 학습데이터 | train | SMCH | raw | internal | train/26_SMCH_Sample-1 |",
        "| 표가 아님 | ... |",
      ].join("\n"),
    );
    const dataPath = path.join(root, "data");
    expect(await readDatasetPaths(dataPath)).toEqual({
      "DS-0001": path.join(dataPath, "patient", "26_SMCH_Occlusion-1"),
      "DS-0002": path.join(dataPath, "train", "26_SMCH_Sample-1"),
    });
  });

  it("returns nothing when the registry file is absent", async () => {
    const root = await tempWorkspace("dataset-registry-missing");
    expect(await readDatasetPaths(path.join(root, "data"))).toEqual({});
  });
});

/**
 * 관례 배치(루트 CLAUDE.md §1): work·dev·data 는 서로 다른 폴더다. 위 픽스처들은 임시 폴더 하나로
 * 셋을 만들지만, 실제로 쓰이는 모양은 이쪽이므로 따로 검사한다.
 */
describe("3형제 루트", () => {
  async function siblings(name: string) {
    const work = await tempWorkspace(`${name}-work`);
    const dev = await tempWorkspace(`${name}-dev`);
    const data = await tempWorkspace(`${name}-data`);
    return { work, dev, data, label: "work-root" };
  }

  it("레포는 dev 루트 기준으로, 데이터셋은 data 루트 기준으로 잡힌다", async () => {
    const roots = await siblings("triple");
    await writeFile(
      path.join(roots.work, "O_SMCH", "24_SMCH_VSP-1", "CLAUDE.md"),
      shellClaude({ title: "가상수술계획", channel: "O_SMCH", repos: "[VSP_FastAPI]", data: "[DS-0001]" }),
    );
    await writeFile(
      path.join(roots.data, "index.md"),
      [
        "| id | title | purpose | source | kind | sensitivity | path |",
        "|---|---|---|---|---|---|---|",
        "| DS-0001 | 교합연구 | patient | SMCH | raw | restricted | patient/26_SMCH_Occlusion-1 |",
      ].join("\n"),
    );

    const snapshot = await new WorkspaceIndex().snapshot(registryOf([roots]));
    expect(snapshot.shells).toHaveLength(1);
    // 셸 경로는 work 루트, 레포 경로는 dev 루트 — work 안의 dev 는 쳐다보지 않는다.
    expect(snapshot.shells[0].path).toBe(path.join(roots.work, "O_SMCH", "24_SMCH_VSP-1"));
    expect(snapshot.repoOwners[workspacePathKey(path.join(roots.dev, "VSP_FastAPI"))]).toBe(
      "O_SMCH/24_SMCH_VSP-1",
    );
    expect(snapshot.repoOwners[workspacePathKey(path.join(roots.dev, "_archive", "VSP_FastAPI"))]).toBe(
      "O_SMCH/24_SMCH_VSP-1",
    );
    expect(snapshot.repoOwners[workspacePathKey(path.join(roots.work, "dev", "VSP_FastAPI"))]).toBeUndefined();
    expect(await readDatasetPaths(roots.data)).toEqual({
      "DS-0001": path.join(roots.data, "patient", "26_SMCH_Occlusion-1"),
    });
  });
});

describe("resolveWorkspaceRoots", () => {
  it("`.ws-index.json`이 선언한 루트가 실재하면 그것을 쓴다", async () => {
    const work = await tempWorkspace("resolve-declared");
    const dev = await tempWorkspace("resolve-declared-dev");
    const data = await tempWorkspace("resolve-declared-data");
    await writeFile(path.join(work, ".ws-index.json"), JSON.stringify({ roots: { work, dev, data } }));
    expect(await resolveWorkspaceRoots(work)).toEqual({ dev, data });
  });

  it("선언이 없거나 그 폴더가 없으면 예전의 중첩 배치를 본다", async () => {
    const work = await tempWorkspace("resolve-nested");
    await fs.mkdir(path.join(work, "dev"), { recursive: true });
    await fs.mkdir(path.join(work, "data"), { recursive: true });
    // 선언은 있지만 그 경로가 아직 없다 — 이전 중간 상태.
    await writeFile(
      path.join(work, ".ws-index.json"),
      JSON.stringify({ roots: { work, dev: path.join(work, "nope-dev"), data: path.join(work, "nope-data") } }),
    );
    expect(await resolveWorkspaceRoots(work)).toEqual({
      dev: path.join(work, "dev"),
      data: path.join(work, "data"),
    });
  });

  it("아무것도 없으면 관례값인 형제 폴더를 적어 둔다", async () => {
    const work = await tempWorkspace("resolve-sibling");
    const parent = path.dirname(work);
    expect(await resolveWorkspaceRoots(work)).toEqual({
      dev: path.join(parent, "dev"),
      data: path.join(parent, "data"),
    });
  });
});
