// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceShellInfo, WorkspaceSnapshot } from "../../shared/workspace-types";
import { workspacePathKey } from "../../shared/workspace-path";
import { buildWorkspaceBrief, renderWorkspaceBrief } from "./workspace-brief";

const tempRoots: string[] = [];

async function tempWorkspace(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), `mcw-${name}-`));
  tempRoots.push(root);
  return root;
}

async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

function shellInfo(root: string, overrides: Partial<WorkspaceShellInfo> = {}): WorkspaceShellInfo {
  return {
    root,
    ref: "O_SMCH/24_SMCH_VSP-1",
    channel: "O_SMCH",
    groupLabel: "용역",
    topics: [],
    shell: "24_SMCH_VSP-1",
    title: "가상수술계획",
    status: "active",
    mode: null,
    archived: false,
    path: path.join(root, "O_SMCH", "24_SMCH_VSP-1"),
    repos: ["VSP_FastAPI", "VSP_MQ_v2"],
    externalPaths: [],
    data: ["DS-0001"],
    drivePath: null,
    wikiPath: null,
    ...overrides,
  };
}

function snapshotFor(root: string, shells: WorkspaceShellInfo[]): WorkspaceSnapshot {
  const repoOwners: Record<string, string> = {};
  for (const shell of shells) {
    for (const repo of shell.repos) repoOwners[workspacePathKey(path.join(root, "dev", repo))] = shell.ref;
    for (const external of shell.externalPaths) repoOwners[workspacePathKey(external)] = shell.ref;
  }
  return {
    registry: {
      schemaVersion: 1,
      updatedAt: "2026-08-30T00:00:00.000Z",
      roots: [{ work: root, dev: path.join(root, "dev"), data: path.join(root, "data"), label: "work" }],
      shellLinks: [],
    },
    shells,
    repoOwners,
    warnings: [],
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("renderWorkspaceBrief", () => {
  it("PRJ 머리 줄과 레포·형제 프로젝트·데이터셋·데이터 명세를 적는다", () => {
    const brief = renderWorkspaceBrief({
      shell: shellInfo("C:\\work", {
        ref: "projects/PRJ-0017-secondbrain",
        channel: "projects",
        shell: "PRJ-0017-secondbrain",
        groupLabel: "개인",
        title: "세컨드브레인(LLMwiki·atlas·bolt)",
        status: "active",
        mode: "continuous",
        path: path.join("C:\\work", "projects", "PRJ-0017-secondbrain"),
        drivePath: path.join("G:\\drive", "projects", "PRJ-0017-secondbrain"),
        wikiPath: path.join("C:\\dev", "llmwiki", "wiki"),
      }),
      rootPrinciplesPath: path.join("C:\\work", "CLAUDE.md"),
      siblingRepos: [{ name: "llmwiki", path: path.join("C:\\dev", "llmwiki") }],
      siblingProjects: [
        { title: "가계부", ref: "projects/PRJ-0016-finance", path: path.join("C:\\work", "projects", "PRJ-0016-finance") },
      ],
      datasets: [
        { id: "DS-0001", path: path.join("C:\\data", "patient", "26_SMCH_Occlusion-1") },
        { id: "DS-9999", path: null },
      ],
      dataNotes: "# 데이터\n- 교합 케이스 10건",
    });

    expect(brief).toContain("# 워크스페이스: projects/PRJ-0017-secondbrain");
    expect(brief).toContain("- 표시명: 세컨드브레인(LLMwiki·atlas·bolt)");
    expect(brief).toContain("- 상태: active");
    expect(brief).toContain("- 진행 방식: continuous");
    expect(brief).toContain("- 컨텍스트: 개인");
    expect(brief).toContain(`- 프로젝트 폴더: ${path.join("C:\\work", "projects", "PRJ-0017-secondbrain")}`);
    expect(brief).toContain(
      `- 프로젝트 문서: ${path.join("C:\\work", "projects", "PRJ-0017-secondbrain", "CLAUDE.md")}`,
    );
    expect(brief).toContain(`- drive 폴더: ${path.join("G:\\drive", "projects", "PRJ-0017-secondbrain")}`);
    expect(brief).toContain(`- 지식 정본: ${path.join("C:\\dev", "llmwiki", "wiki")}`);
    expect(brief).toContain(`- 루트 원칙: ${path.join("C:\\work", "CLAUDE.md")}`);
    expect(brief).toContain("## 이 프로젝트의 레포 (로컬 절대경로)");
    expect(brief).toContain(`- llmwiki: ${path.join("C:\\dev", "llmwiki")}`);
    expect(brief).toContain("## 같은 컨텍스트(개인)의 다른 프로젝트");
    expect(brief).toContain("- 가계부 (projects/PRJ-0016-finance)");
    expect(brief).toContain("## 이 프로젝트가 쓰는 데이터셋");
    expect(brief).toContain("- DS-9999: (data/index.md에 없음)");
    expect(brief).toContain("- 교합 케이스 10건");
    // 채널은 v2에 없는 개념이다.
    expect(brief).not.toContain("- 채널:");
  });

  it("값이 없는 줄과 절을 생략한다", () => {
    const brief = renderWorkspaceBrief({
      shell: shellInfo("C:\\work", { status: null, mode: null, groupLabel: "", repos: [], data: [] }),
      rootPrinciplesPath: path.join("C:\\work", "CLAUDE.md"),
      siblingRepos: [],
      siblingProjects: [],
      datasets: [],
      dataNotes: null,
    });
    expect(brief).not.toContain("- 상태:");
    expect(brief).not.toContain("- 진행 방식:");
    expect(brief).not.toContain("- 컨텍스트:");
    expect(brief).not.toContain("- drive 폴더:");
    expect(brief).not.toContain("- 지식 정본:");
    expect(brief).not.toContain("## 이 프로젝트의 레포");
    expect(brief).not.toContain("## 같은 컨텍스트");
    expect(brief).not.toContain("## 이 프로젝트가 쓰는 데이터셋");
    expect(brief).not.toContain("데이터 명세 발췌");
  });
});

describe("buildWorkspaceBrief", () => {
  it("builds the brief for a repo that belongs to a shell", async () => {
    const root = await tempWorkspace("brief-repo");
    await writeFile(
      path.join(root, "data", "index.md"),
      [
        "| id | title | purpose | source | kind | sensitivity | path |",
        "|---|---|---|---|---|---|---|",
        "| DS-0001 | 교합연구 | patient | SMCH | raw | restricted | patient/26_SMCH_Occlusion-1 |",
      ].join("\n"),
    );
    await writeFile(
      path.join(root, "O_SMCH", "24_SMCH_VSP-1", "wiki", "data.md"),
      Array.from({ length: 40 }, (_, index) => `줄 ${index + 1}`).join("\n"),
    );
    const snapshot = snapshotFor(root, [
      shellInfo(root),
      shellInfo(root, {
        ref: "O_SMCH/25_SMCH_FOAA-1",
        shell: "25_SMCH_FOAA-1",
        title: "FOAA",
        path: path.join(root, "O_SMCH", "25_SMCH_FOAA-1"),
        repos: ["FOAA_release"],
        data: [],
      }),
      shellInfo(root, {
        ref: "P_Personal/26_Personal_Career-1",
        channel: "P_Personal",
        groupLabel: "개인",
        shell: "26_Personal_Career-1",
        title: "진로",
        path: path.join(root, "P_Personal", "26_Personal_Career-1"),
        repos: [],
        data: [],
      }),
    ]);

    const brief = await buildWorkspaceBrief(path.join(root, "dev", "VSP_FastAPI"), snapshot);
    expect(brief).toContain("# 워크스페이스: O_SMCH/24_SMCH_VSP-1");
    expect(brief).toContain(`- VSP_MQ_v2: ${path.join(root, "dev", "VSP_MQ_v2")}`);
    expect(brief).toContain(`- DS-0001: ${path.join(root, "data", "patient", "26_SMCH_Occlusion-1")}`);
    // 형제는 같은 묶음 라벨만 — 다른 컨텍스트의 프로젝트는 이 세션과 무관하다.
    expect(brief).toContain("- FOAA (O_SMCH/25_SMCH_FOAA-1)");
    expect(brief).not.toContain("P_Personal/26_Personal_Career-1");
    // wiki/data.md는 앞 30줄만.
    expect(brief).toContain("줄 30");
    expect(brief).not.toContain("줄 31");
  });

  it("같은 묶음 라벨의 프로젝트만 형제로 세우고, 휴면끼리만 묶는다", async () => {
    const root = await tempWorkspace("brief-siblings");
    const base = (key: string, groupLabel: string, archived = false) =>
      shellInfo(root, {
        ref: `${archived ? "projects/_archive" : "projects"}/${key}`,
        channel: archived ? "projects/_archive" : "projects",
        shell: key,
        groupLabel,
        title: key,
        archived,
        path: path.join(root, archived ? path.join("projects", "_archive") : "projects", key),
        repos: key === "PRJ-0017-secondbrain" ? ["multi-cli-work"] : [],
        data: [],
      });
    const snapshot = snapshotFor(root, [
      base("PRJ-0017-secondbrain", "개인"),
      base("PRJ-0016-finance", "개인"),
      base("PRJ-0006-vsp", "병원 공동연구"),
      base("PRJ-0009-old", "개인", true),
    ]);

    const brief = await buildWorkspaceBrief(path.join(root, "dev", "multi-cli-work"), snapshot);
    expect(brief).toContain("## 같은 컨텍스트(개인)의 다른 프로젝트");
    expect(brief).toContain("PRJ-0016-finance");
    expect(brief).not.toContain("PRJ-0006-vsp");
    expect(brief).not.toContain("PRJ-0009-old");
  });

  it("묶음 라벨이 비어 있으면 형제 절이 없다", async () => {
    const root = await tempWorkspace("brief-no-label");
    const snapshot = snapshotFor(root, [
      shellInfo(root, { groupLabel: "", repos: ["VSP_FastAPI"], data: [] }),
      shellInfo(root, { ref: "O_SMCH/25_SMCH_FOAA-1", shell: "25_SMCH_FOAA-1", groupLabel: "", repos: [], data: [] }),
    ]);
    const brief = await buildWorkspaceBrief(path.join(root, "dev", "VSP_FastAPI"), snapshot);
    expect(brief).not.toContain("## 같은 컨텍스트");
  });

  it("also answers for the shell folder itself and for a folder inside a repo", async () => {
    const root = await tempWorkspace("brief-shell");
    const snapshot = snapshotFor(root, [shellInfo(root)]);
    expect(await buildWorkspaceBrief(path.join(root, "O_SMCH", "24_SMCH_VSP-1"), snapshot)).toContain(
      "# 워크스페이스: O_SMCH/24_SMCH_VSP-1",
    );
    expect(await buildWorkspaceBrief(path.join(root, "dev", "VSP_FastAPI", "src"), snapshot)).toContain(
      "# 워크스페이스: O_SMCH/24_SMCH_VSP-1",
    );
  });

  it("returns null for a folder outside every workspace root", async () => {
    const root = await tempWorkspace("brief-outside");
    const snapshot = snapshotFor(root, [shellInfo(root)]);
    expect(await buildWorkspaceBrief(path.join(root, "dev", "Unlinked"), snapshot)).toBeNull();
    expect(await buildWorkspaceBrief(path.join("C:", "elsewhere", "repo"), snapshot)).toBeNull();
  });

  it("names the datasets it cannot resolve rather than dropping them", async () => {
    const root = await tempWorkspace("brief-dataset-missing");
    const snapshot = snapshotFor(root, [shellInfo(root, { data: ["DS-0404"] })]);
    const brief = await buildWorkspaceBrief(path.join(root, "dev", "VSP_FastAPI"), snapshot);
    expect(brief).toContain("- DS-0404: (data/index.md에 없음)");
  });
});

/** 관례 배치에서 브리프의 레포·데이터셋 경로가 각각 dev·data 루트를 가리키는지. */
describe("buildWorkspaceBrief — 3형제 루트", () => {
  it("레포는 dev 루트, 데이터셋은 data 루트 절대경로로 적는다", async () => {
    const work = await tempWorkspace("brief-triple-work");
    const dev = await tempWorkspace("brief-triple-dev");
    const data = await tempWorkspace("brief-triple-data");
    await writeFile(
      path.join(data, "index.md"),
      [
        "| id | title | purpose | source | kind | sensitivity | path |",
        "|---|---|---|---|---|---|---|",
        "| DS-0001 | 교합연구 | patient | SMCH | raw | restricted | patient/26_SMCH_Occlusion-1 |",
      ].join("\n"),
    );
    const shell = shellInfo(work, { path: path.join(work, "O_SMCH", "24_SMCH_VSP-1") });
    const snapshot: WorkspaceSnapshot = {
      registry: {
        schemaVersion: 1,
        updatedAt: "2026-08-30T00:00:00.000Z",
        roots: [{ work, dev, data, label: "work-root" }],
        shellLinks: [],
      },
      shells: [shell],
      repoOwners: Object.fromEntries(
        shell.repos.map((repo) => [workspacePathKey(path.join(dev, repo)), shell.ref]),
      ),
      warnings: [],
    };

    const brief = await buildWorkspaceBrief(path.join(dev, "VSP_FastAPI"), snapshot);
    expect(brief).toContain(`- VSP_FastAPI: ${path.join(dev, "VSP_FastAPI")}`);
    expect(brief).toContain(`- VSP_MQ_v2: ${path.join(dev, "VSP_MQ_v2")}`);
    expect(brief).toContain(`- DS-0001: ${path.join(data, "patient", "26_SMCH_Occlusion-1")}`);
    expect(brief).toContain(`- 루트 원칙: ${path.join(work, "CLAUDE.md")}`);
  });
});
