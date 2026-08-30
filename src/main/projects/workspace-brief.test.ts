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
    channelLetter: "O",
    channelLabel: "용역",
    shell: "24_SMCH_VSP-1",
    title: "가상수술계획",
    status: "active",
    path: path.join(root, "O_SMCH", "24_SMCH_VSP-1"),
    repos: ["VSP_FastAPI", "VSP_MQ_v2"],
    externalPaths: [],
    data: ["DS-0001"],
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
      roots: [{ path: root, label: "ws", devPath: path.join(root, "dev"), dataPath: path.join(root, "data") }],
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
  it("names the shell and lists siblings, datasets and the data notes", () => {
    const brief = renderWorkspaceBrief({
      shell: shellInfo("C:\\ws"),
      rootPrinciplesPath: path.join("C:\\ws", "CLAUDE.md"),
      siblingRepos: [
        { name: "VSP_FastAPI", path: path.join("C:\\ws", "dev", "VSP_FastAPI") },
        { name: "VSP_MQ_v2", path: path.join("C:\\ws", "dev", "VSP_MQ_v2") },
      ],
      siblingShells: [
        { title: "FOAA", ref: "O_SMCH/25_SMCH_FOAA-1", path: path.join("C:\\ws", "O_SMCH", "25_SMCH_FOAA-1") },
      ],
      datasets: [
        { id: "DS-0001", path: path.join("C:\\ws", "data", "patient", "26_SMCH_Occlusion-1") },
        { id: "DS-9999", path: null },
      ],
      dataNotes: "# 데이터\n- 교합 케이스 10건",
    });

    expect(brief).toContain("# 워크스페이스: O_SMCH/24_SMCH_VSP-1");
    expect(brief).toContain("- 표시명: 가상수술계획");
    expect(brief).toContain("- 상태: active");
    expect(brief).toContain("- 채널: O_SMCH (용역)");
    expect(brief).toContain(`- 루트 원칙: ${path.join("C:\\ws", "CLAUDE.md")}`);
    expect(brief).toContain(`- VSP_FastAPI: ${path.join("C:\\ws", "dev", "VSP_FastAPI")}`);
    expect(brief).toContain("- FOAA (O_SMCH/25_SMCH_FOAA-1)");
    expect(brief).toContain(`- DS-0001: ${path.join("C:\\ws", "data", "patient", "26_SMCH_Occlusion-1")}`);
    expect(brief).toContain("- DS-9999: (data/index.md에 없음)");
    expect(brief).toContain("- 교합 케이스 10건");
  });

  it("omits empty sections", () => {
    const brief = renderWorkspaceBrief({
      shell: shellInfo("C:\\ws", { status: null, repos: [], data: [] }),
      rootPrinciplesPath: path.join("C:\\ws", "CLAUDE.md"),
      siblingRepos: [],
      siblingShells: [],
      datasets: [],
      dataNotes: null,
    });
    expect(brief).not.toContain("- 상태:");
    expect(brief).not.toContain("## 같은 셸의 레포");
    expect(brief).not.toContain("## 같은 채널");
    expect(brief).not.toContain("## 이 셸이 쓰는 데이터셋");
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
        channelLetter: "P",
        channelLabel: "개인",
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
    // 형제 셸은 같은 채널만 — 다른 채널의 셸은 이 세션과 무관하다.
    expect(brief).toContain("- FOAA (O_SMCH/25_SMCH_FOAA-1)");
    expect(brief).not.toContain("P_Personal/26_Personal_Career-1");
    // wiki/data.md는 앞 30줄만.
    expect(brief).toContain("줄 30");
    expect(brief).not.toContain("줄 31");
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
