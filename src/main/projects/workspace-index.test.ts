// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceRegistryV1 } from "../../shared/workspace-types";
import { workspacePathKey } from "../../shared/workspace-path";
import { WorkspaceIndex, readDatasetPaths, resolveLogicalPath, resolveWorkspaceRoots } from "./workspace-index";

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

/** PROJECT.yaml은 `---` 울타리가 없는 순수 YAML이다 — 셸 CLAUDE.md와 모양이 다르다. */
function projectYaml(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

/** 액티브 Project 하나를 만든다. */
async function writeProject(root: string, key: string, fields: Record<string, string>): Promise<void> {
  await writeFile(path.join(root, "projects", key, "PROJECT.yaml"), projectYaml(fields));
}

/** 휴면 Project 하나를 만든다. */
async function writeArchivedProject(root: string, key: string, fields: Record<string, string>): Promise<void> {
  await writeFile(path.join(root, "projects", "_archive", key, "PROJECT.yaml"), projectYaml(fields));
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
      groupLabel: "용역",
      shell: "24_SMCH_VSP-1",
      repos: ["VSP_FastAPI", "VSP_MQ_v2"],
      data: ["DS-0001"],
      path: path.join(root, "O_SMCH", "24_SMCH_VSP-1"),
    });
    // v1 스캔은 v2 전용 필드를 고정값으로 채운다 — 동작이 v1.30과 같다는 뜻이다.
    expect(vsp).toMatchObject({
      topics: [],
      mode: null,
      archived: false,
      drivePath: null,
      wikiPath: null,
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

/**
 * 2026-09-05에 ws-root가 옮겨 간 평면 구조. v1 describe들을 그대로 두는 것이 폴백 회귀 테스트다.
 */
describe("WorkspaceIndex — v2 PRJ 평면 구조", () => {
  const SECONDBRAIN = {
    schema: "1",
    key: "PRJ-0017-secondbrain",
    slug: "secondbrain",
    title: "세컨드브레인(LLMwiki·atlas·bolt)",
    mode: "continuous",
    status: "active",
    primaryContext: "개인",
    topics: "[지식관리, 자동화]",
    repos: "[multi-cli-work, llmwiki]",
    externalPaths: "[]",
    data: "[DS-0001]",
    wikiSource: "dev/llmwiki/wiki",
  };

  it("PROJECT.yaml을 읽어 ref·채널·표시명·컨텍스트·mode를 만든다", async () => {
    const root = await tempWorkspace("v2-scan");
    await writeProject(root, "PRJ-0017-secondbrain", SECONDBRAIN);
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));

    expect(snapshot.shells).toHaveLength(1);
    expect(snapshot.shells[0]).toMatchObject({
      ref: "projects/PRJ-0017-secondbrain",
      channel: "projects",
      shell: "PRJ-0017-secondbrain",
      groupLabel: "개인",
      topics: ["지식관리", "자동화"],
      title: "세컨드브레인(LLMwiki·atlas·bolt)",
      status: "active",
      mode: "continuous",
      archived: false,
      path: path.join(root, "projects", "PRJ-0017-secondbrain"),
      repos: ["multi-cli-work", "llmwiki"],
      data: ["DS-0001"],
      drivePath: null,
    });
    expect(snapshot.warnings).toEqual([]);
  });

  it("레포 역인덱스에 dev 루트와 dev/_archive 두 자리를 모두 등록한다", async () => {
    const root = await tempWorkspace("v2-repos");
    await writeProject(root, "PRJ-0017-secondbrain", SECONDBRAIN);
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));

    expect(snapshot.repoOwners[workspacePathKey(path.join(root, "dev", "multi-cli-work"))]).toBe(
      "projects/PRJ-0017-secondbrain",
    );
    expect(snapshot.repoOwners[workspacePathKey(path.join(root, "dev", "_archive", "llmwiki"))]).toBe(
      "projects/PRJ-0017-secondbrain",
    );
  });

  /**
   * v2의 `externalPaths`는 **논리 경로**다 — work 쪽 `project-manifest.mjs`의 `ABS_OR_ESCAPE_RE`가
   * 절대경로를 거부하므로 `C:\…`가 올 수 없다. v1의 `external_paths`(절대경로)와 의미가 다르다.
   */
  it("externalPaths의 논리 경로를 절대경로로 풀어 역인덱스에 넣는다", async () => {
    const root = await tempWorkspace("v2-external");
    const onedrive = await tempWorkspace("v2-external-onedrive");
    const shared = "수행프로젝트(기술연구소) - 문서/O_삼성서울병원";
    await writeProject(root, "PRJ-0006-vsp", {
      key: "PRJ-0006-vsp",
      title: "가상수술계획",
      status: "active",
      primaryContext: "병원 공동연구",
      // 한글·공백·괄호가 든 상대경로가 그대로 풀려야 한다.
      externalPaths: `[onedrive/${shared}, dev/side-repo]`,
    });
    await writeFile(
      path.join(root, ".ws-index.json"),
      JSON.stringify({
        schemaVersion: 2,
        roots: { work: root, dev: path.join(root, "dev"), data: path.join(root, "data"), onedrive },
      }),
    );

    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    const resolved = path.join(onedrive, "수행프로젝트(기술연구소) - 문서", "O_삼성서울병원");
    expect(snapshot.shells[0].externalPaths).toEqual([resolved, path.join(root, "dev", "side-repo")]);
    expect(snapshot.repoOwners[workspacePathKey(resolved)]).toBe("projects/PRJ-0006-vsp");
    expect(snapshot.warnings).toEqual([]);
  });

  it("못 푸는 논리 경로는 조용히 뺀다 — onedrive 루트가 없을 때", async () => {
    const root = await tempWorkspace("v2-external-unresolved");
    await writeProject(root, "PRJ-0006-vsp", {
      key: "PRJ-0006-vsp",
      title: "가상수술계획",
      status: "active",
      primaryContext: "병원 공동연구",
      externalPaths: "[onedrive/수행프로젝트/O_삼성서울병원, dev/side-repo]",
    });
    // `.ws-index.json`이 없으니 onedrive 루트를 알 수 없다.
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    expect(snapshot.shells[0].externalPaths).toEqual([path.join(root, "dev", "side-repo")]);
    // DRIVE_ROOT·ONEDRIVE_ROOT 미설정은 경고할 일이 아니다.
    expect(snapshot.warnings).toEqual([]);
  });

  /**
   * 한 폴더가 여러 Project의 `externalPaths`에 동시에 들어간다(실제로 `O_삼성서울병원` 하나가
   * PRJ-0006·0010·0011 셋에 들어간다). `WorkProject.members`가 "한 폴더는 한 업무 프로젝트에만
   * 속한다"를 SSOT로 두므로 누군가는 이겨야 하고, v1부터의 규칙은 **마지막에 쓴 것이 이긴다**다.
   */
  it("같은 경로를 여러 Project가 등록하면 마지막이 이기고 경고 한 줄이 선다", async () => {
    const root = await tempWorkspace("v2-shared-path");
    const onedrive = await tempWorkspace("v2-shared-onedrive");
    for (const key of ["PRJ-0006-vsp", "PRJ-0010-foaa", "PRJ-0011-navi"]) {
      await writeProject(root, key, {
        key,
        title: key,
        status: "active",
        primaryContext: "병원 공동연구",
        externalPaths: "[onedrive/공유/O_삼성서울병원]",
      });
    }
    await writeFile(
      path.join(root, ".ws-index.json"),
      JSON.stringify({
        schemaVersion: 2,
        roots: { work: root, dev: path.join(root, "dev"), data: path.join(root, "data"), onedrive },
      }),
    );

    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    const shared = path.join(onedrive, "공유", "O_삼성서울병원");
    // 폴더 이름 정렬이라 PRJ-0011-navi가 마지막이다 — 실행마다 같은 답이다.
    expect(snapshot.repoOwners[workspacePathKey(shared)]).toBe("projects/PRJ-0011-navi");
    expect(snapshot.warnings).toEqual([
      `[path-owner] ${shared}: 3개 프로젝트가 같은 경로를 등록했다(projects/PRJ-0006-vsp · projects/PRJ-0010-foaa · projects/PRJ-0011-navi) — projects/PRJ-0011-navi가 이긴다`,
    ]);
  });

  it("같은 레포 이름을 두 Project가 등록하면 경고가 한 줄만 선다", async () => {
    const root = await tempWorkspace("v2-shared-repo");
    await writeProject(root, "PRJ-0006-vsp", {
      key: "PRJ-0006-vsp",
      title: "가상수술계획",
      status: "active",
      primaryContext: "병원 공동연구",
      repos: "[shared-lib]",
    });
    await writeProject(root, "PRJ-0011-navi", {
      key: "PRJ-0011-navi",
      title: "내비게이션",
      status: "active",
      primaryContext: "병원 공동연구",
      repos: "[shared-lib]",
    });

    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    expect(snapshot.repoOwners[workspacePathKey(path.join(root, "dev", "shared-lib"))]).toBe(
      "projects/PRJ-0011-navi",
    );
    // 레포 하나가 역인덱스 키 둘(`dev/x`·`dev/_archive/x`)을 만들지만 경고는 이름 단위로 한 줄이다.
    expect(snapshot.warnings).toEqual([
      "[repo-owner] shared-lib: 2개 프로젝트가 같은 레포를 등록했다(projects/PRJ-0006-vsp · projects/PRJ-0011-navi) — projects/PRJ-0011-navi가 이긴다",
    ]);
  });

  it("휴면 Project는 projects/_archive를 담은 ref와 archived 표식을 받는다", async () => {
    const root = await tempWorkspace("v2-archived");
    await writeProject(root, "PRJ-0017-secondbrain", SECONDBRAIN);
    await writeArchivedProject(root, "PRJ-0001-kitu-undergraduate", {
      key: "PRJ-0001-kitu-undergraduate",
      title: "(휴면) 금오공대 학부 자료",
      status: "archived",
      mode: "finite",
      primaryContext: "대학원 학사",
    });
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));

    const dormant = snapshot.shells.find((shell) => shell.archived)!;
    expect(dormant).toMatchObject({
      ref: "projects/_archive/PRJ-0001-kitu-undergraduate",
      channel: "projects/_archive",
      shell: "PRJ-0001-kitu-undergraduate",
      archived: true,
      status: "archived",
      path: path.join(root, "projects", "_archive", "PRJ-0001-kitu-undergraduate"),
    });
  });

  it("표시명이 없으면 PRJ-key로, 컨텍스트가 없으면 빈 라벨로 떨어진다", async () => {
    const root = await tempWorkspace("v2-untitled");
    await writeProject(root, "PRJ-0016-finance", { key: "PRJ-0016-finance", status: "active" });
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    expect(snapshot.shells[0]).toMatchObject({
      title: "PRJ-0016-finance",
      groupLabel: "",
      topics: [],
      mode: null,
      wikiPath: null,
    });
  });

  it("키 규약 위반과 PROJECT.yaml 없음을 경고로 남기고, 점·밑줄 폴더는 조용히 넘긴다", async () => {
    const root = await tempWorkspace("v2-warn");
    await writeProject(root, "PRJ-0017-secondbrain", SECONDBRAIN);
    await fs.mkdir(path.join(root, "projects", "not-a-key"), { recursive: true });
    await fs.mkdir(path.join(root, "projects", "PRJ-0099-empty"), { recursive: true });
    await fs.mkdir(path.join(root, "projects", "_local"), { recursive: true });
    await fs.mkdir(path.join(root, "projects", ".obsidian"), { recursive: true });
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));

    expect(snapshot.shells.map((shell) => shell.shell)).toEqual(["PRJ-0017-secondbrain"]);
    expect(snapshot.warnings).toEqual([
      "[project-yaml] projects/PRJ-0099-empty: PROJECT.yaml 없음",
      "[project-key] projects/not-a-key: 프로젝트 키 규약 위반(PRJ-####-slug)",
    ]);
  });

  it("v2 루트에 남은 legacy 채널 폴더는 무시하고 한 줄 경고한다", async () => {
    const root = await tempWorkspace("v2-mixed");
    await writeProject(root, "PRJ-0017-secondbrain", SECONDBRAIN);
    await writeFile(
      path.join(root, "O_SMCH", "24_SMCH_VSP-1", "CLAUDE.md"),
      shellClaude({ title: "가상수술계획", channel: "O_SMCH" }),
    );
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));

    expect(snapshot.shells.map((shell) => shell.ref)).toEqual(["projects/PRJ-0017-secondbrain"]);
    expect(snapshot.warnings).toEqual([
      "[legacy-layout] O_SMCH: projects/ 평면 구조로 옮긴 뒤 남은 폴더",
    ]);
  });

  it("projects/ 가 없으면 v1 채널 스캔으로 떨어진다", async () => {
    const root = await fixture("v2-fallback");
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    expect(snapshot.shells.map((shell) => shell.ref).sort()).toEqual([
      "O_ATNC/24_ATNC_NeuroPilot-1",
      "O_SMCH/24_SMCH_VSP-1",
    ]);
  });

  it("PROJECT.yaml의 mtime으로 캐시를 판정한다", async () => {
    const root = await tempWorkspace("v2-cache");
    await writeProject(root, "PRJ-0017-secondbrain", SECONDBRAIN);
    const yaml = path.join(root, "projects", "PRJ-0017-secondbrain", "PROJECT.yaml");
    const index = new WorkspaceIndex();
    const titleOf = async () => (await index.snapshot(registryFor(root))).shells[0]?.title;

    await touch(yaml, 1_000);
    expect(await titleOf()).toBe("세컨드브레인(LLMwiki·atlas·bolt)");

    // 내용만 바꾸고 mtime을 되돌리면 캐시가 유지된다 — 판정이 mtime이라는 증거.
    await fs.writeFile(yaml, projectYaml({ ...SECONDBRAIN, title: "새 이름" }), "utf8");
    await touch(yaml, 1_000);
    expect(await titleOf()).toBe("세컨드브레인(LLMwiki·atlas·bolt)");

    await touch(yaml, 9_000);
    expect(await titleOf()).toBe("새 이름");
  });

  it("drive 루트가 선언되고 그 폴더가 실재할 때만 drive 경로를 준다", async () => {
    const root = await tempWorkspace("v2-drive");
    const drive = await tempWorkspace("v2-drive-root");
    await writeProject(root, "PRJ-0017-secondbrain", SECONDBRAIN);
    await writeProject(root, "PRJ-0016-finance", {
      key: "PRJ-0016-finance",
      title: "가계부",
      status: "active",
      primaryContext: "개인",
    });
    // 짝 폴더는 PRJ-0017에만 있다.
    await fs.mkdir(path.join(drive, "projects", "PRJ-0017-secondbrain"), { recursive: true });
    await writeFile(
      path.join(root, ".ws-index.json"),
      JSON.stringify({ schemaVersion: 2, roots: { work: root, dev: path.join(root, "dev"), data: path.join(root, "data"), drive } }),
    );

    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    const byKey = new Map(snapshot.shells.map((shell) => [shell.shell, shell]));
    expect(byKey.get("PRJ-0017-secondbrain")?.drivePath).toBe(path.join(drive, "projects", "PRJ-0017-secondbrain"));
    expect(byKey.get("PRJ-0016-finance")?.drivePath).toBeNull();
    // DRIVE_ROOT 미설정도, 짝 폴더 없음도 경고할 일이 아니다.
    expect(snapshot.warnings).toEqual([]);
  });

  it("drive 선언이 없으면 조용히 null이다", async () => {
    const root = await tempWorkspace("v2-no-drive");
    await writeProject(root, "PRJ-0017-secondbrain", SECONDBRAIN);
    await writeFile(
      path.join(root, ".ws-index.json"),
      JSON.stringify({ schemaVersion: 2, roots: { work: root, dev: path.join(root, "dev"), data: path.join(root, "data") } }),
    );
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    expect(snapshot.shells[0].drivePath).toBeNull();
    expect(snapshot.warnings).toEqual([]);
  });

  it("wikiSource의 dev/ 논리 경로를 등록된 dev 루트로 푼다", async () => {
    const root = await tempWorkspace("v2-wiki");
    await writeProject(root, "PRJ-0017-secondbrain", SECONDBRAIN);
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    expect(snapshot.shells[0].wikiPath).toBe(path.join(root, "dev", "llmwiki", "wiki"));
  });

  it("drive/ 논리 경로는 drive 루트가 없으면 null이다 — work 기준으로 떨어지지 않는다", async () => {
    const root = await tempWorkspace("v2-wiki-drive");
    await writeProject(root, "PRJ-0013-readingarchive", {
      key: "PRJ-0013-readingarchive",
      title: "독서기록",
      status: "active",
      primaryContext: "개인",
      wikiSource: "drive/reading/wiki",
    });
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    expect(snapshot.shells[0].wikiPath).toBeNull();
  });
});

describe("resolveLogicalPath", () => {
  const root = { work: "C:\\work", dev: "C:\\dev", data: "C:\\data", label: "work-root" };
  const extra = { drive: "G:\\내 드라이브", onedrive: "C:\\OneDrive" };

  it("dev·data·drive·onedrive 접두를 각 루트로 푼다", () => {
    expect(resolveLogicalPath(root, extra, "dev/llmwiki/wiki")).toBe(path.join("C:\\dev", "llmwiki", "wiki"));
    expect(resolveLogicalPath(root, extra, "data/patient")).toBe(path.join("C:\\data", "patient"));
    expect(resolveLogicalPath(root, extra, "drive/reading")).toBe(path.join("G:\\내 드라이브", "reading"));
    expect(resolveLogicalPath(root, extra, "onedrive/팀즈")).toBe(path.join("C:\\OneDrive", "팀즈"));
  });

  it("한글·공백·괄호가 든 실제 externalPaths 값을 그대로 푼다", () => {
    // work 쪽이 2026-09-21에 등록한 값 — PRJ-0006·0010·0011이 공유하는 폴더다.
    expect(resolveLogicalPath(root, extra, "onedrive/수행프로젝트(기술연구소) - 문서/O_삼성서울병원")).toBe(
      path.join("C:\\OneDrive", "수행프로젝트(기술연구소) - 문서", "O_삼성서울병원"),
    );
    expect(resolveLogicalPath(root, extra, "onedrive/수행프로젝트(기술연구소) - 문서/G_보건의료과제")).toBe(
      path.join("C:\\OneDrive", "수행프로젝트(기술연구소) - 문서", "G_보건의료과제"),
    );
  });

  it("접두가 없으면 work 기준이고, 역슬래시 입력도 같은 답이다", () => {
    expect(resolveLogicalPath(root, extra, "wiki/entities")).toBe(path.join("C:\\work", "wiki", "entities"));
    expect(resolveLogicalPath(root, extra, "wiki\\entities")).toBe(path.join("C:\\work", "wiki", "entities"));
  });

  it("미설정 drive·onedrive는 null이다 — work 기준 유령 경로를 만들지 않는다", () => {
    const none = { drive: null, onedrive: null };
    expect(resolveLogicalPath(root, none, "drive/reading")).toBeNull();
    expect(resolveLogicalPath(root, none, "onedrive/x")).toBeNull();
    expect(resolveLogicalPath(root, none, "dev/llmwiki")).toBe(path.join("C:\\dev", "llmwiki"));
  });

  it("빈 값은 null이다", () => {
    expect(resolveLogicalPath(root, extra, "")).toBeNull();
    expect(resolveLogicalPath(root, extra, "   ")).toBeNull();
  });

  it("`..` 조각이 있으면 어느 구분자든 null이다 — 루트 밖으로 새지 않는다", () => {
    for (const escape of [
      "..",
      "../secret",
      "dev/../../Windows",
      "wiki\\..\\..\\x",
      "drive/reading/../..",
      "onedrive\\..",
    ]) {
      expect(resolveLogicalPath(root, extra, escape), escape).toBeNull();
    }
    // 조각의 일부로 든 점은 괜찮다.
    expect(resolveLogicalPath(root, extra, "dev/a..b/.hidden")).toBe(path.join("C:\\dev", "a..b", ".hidden"));
  });

  it("절대경로·드라이브 문자는 null이다 — 논리 경로가 아니다", () => {
    for (const absolute of ["C:\\work\\wiki", "C:/work/wiki", "c:", "D:relative", "/etc/passwd", "\\\\server\\share", "\\root"]) {
      expect(resolveLogicalPath(root, extra, absolute), absolute).toBeNull();
    }
  });
});
