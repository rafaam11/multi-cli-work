import fs from "node:fs/promises";
import path from "node:path";
import type { WorkspaceShellInfo, WorkspaceSnapshot } from "../../shared/workspace-types";
import { pathStyleFor, resolveShellRefForPath } from "../../shared/workspace-path";
import { readDatasetPaths } from "./workspace-index";

/**
 * 세션이 선 폴더가 ws-root 워크스페이스의 일이면, 그 프로젝트가 무엇이고 옆에 무엇이 있는지 적어 준다.
 * 루트 CLAUDE.md §7-3이 말하는 "동적 정보(형제 레포 절대경로·데이터셋 경로·형제 셸)를 세션
 * 브리프가 얹는다"가 이 파일이다 — 정적 규칙은 `CLAUDE.md` 캐스케이드가 이미 싣는다.
 *
 * 워크스페이스에는 아무것도 쓰지 않는다. 읽기만 한다.
 */

/** 셸 `wiki/data.md`에서 브리프에 실을 줄 수. 명세 전체가 아니라 "무엇을 쓰는지"만 보여 준다. */
const DATA_NOTE_LINES = 30;

export interface WorkspaceBriefRepo {
  name: string;
  path: string;
}

export interface WorkspaceBriefSibling {
  title: string;
  ref: string;
  path: string;
}

export interface WorkspaceBriefDataset {
  id: string;
  /** `data/index.md`에 없는 id는 경로가 없다 — 브리프는 그 사실을 감추지 않는다. */
  path: string | null;
}

export interface WorkspaceBriefInput {
  shell: WorkspaceShellInfo;
  /** 루트 마스터 원칙 파일(`<root>/CLAUDE.md`)의 절대경로. */
  rootPrinciplesPath: string;
  siblingRepos: WorkspaceBriefRepo[];
  /** 같은 묶음 라벨(v2 컨텍스트 · v1 채널 라벨)을 가진 다른 프로젝트. */
  siblingProjects: WorkspaceBriefSibling[];
  datasets: WorkspaceBriefDataset[];
  /** 프로젝트 `wiki/data.md` 앞부분. 없으면 null. */
  dataNotes: string | null;
}

export function renderWorkspaceBrief(input: WorkspaceBriefInput): string {
  const { shell } = input;
  const lines = [
    `# 워크스페이스: ${shell.ref}`,
    "",
    `- 표시명: ${shell.title}`,
    ...(shell.status ? [`- 상태: ${shell.status}`] : []),
    // mode는 여기 한 줄로만 쓰인다 — 앱의 어떤 코드도 이 값으로 분기하지 않는다.
    ...(shell.mode ? [`- 진행 방식: ${shell.mode}`] : []),
    ...(shell.groupLabel ? [`- 컨텍스트: ${shell.groupLabel}`] : []),
    `- 프로젝트 폴더: ${shell.path}`,
    `- 프로젝트 문서: ${path.join(shell.path, "CLAUDE.md")}`,
    // drive 짝 폴더는 DRIVE_ROOT가 설정되고 그 폴더가 실재할 때만 값이 있다.
    ...(shell.drivePath ? [`- drive 폴더: ${shell.drivePath}`] : []),
    ...(shell.wikiPath ? [`- 지식 정본: ${shell.wikiPath}`] : []),
    `- 루트 원칙: ${input.rootPrinciplesPath}`,
  ];
  if (input.siblingRepos.length > 0) {
    lines.push("", "## 이 프로젝트의 레포 (로컬 절대경로)");
    lines.push(...input.siblingRepos.map((repo) => `- ${repo.name}: ${repo.path}`));
  }
  if (input.siblingProjects.length > 0) {
    lines.push("", `## 같은 컨텍스트(${shell.groupLabel})의 다른 프로젝트`);
    lines.push(...input.siblingProjects.map((sibling) => `- ${sibling.title} (${sibling.ref}): ${sibling.path}`));
  }
  if (input.datasets.length > 0) {
    lines.push("", "## 이 프로젝트가 쓰는 데이터셋");
    lines.push(
      ...input.datasets.map((dataset) =>
        dataset.path ? `- ${dataset.id}: ${dataset.path}` : `- ${dataset.id}: (data/index.md에 없음)`,
      ),
    );
  }
  if (input.dataNotes) {
    lines.push("", `## 데이터 명세 발췌 (wiki/data.md 앞 ${DATA_NOTE_LINES}줄)`, input.dataNotes);
  }
  lines.push(
    "",
    "코드는 `dev/` 레포에, 문서·지식·데이터 명세는 프로젝트 폴더에 둔다. 다른 프로젝트의 지식은",
    "링크하지 말고 `/wiki-borrow`로 재검토·복제한다. 루트 원칙 파일이 이 워크스페이스의 상위 규칙이다.",
    "",
  );
  return lines.join("\n");
}

async function readHead(file: string, maxLines: number): Promise<string | null> {
  try {
    const text = await fs.readFile(file, "utf8");
    const lines = text.split(/\r?\n/);
    const head = lines.slice(0, maxLines).join("\n").trimEnd();
    return head.length > 0 ? head : null;
  } catch {
    return null;
  }
}

/**
 * 이 폴더가 어느 셸의 일인지 찾고, 그 셸의 브리프를 만든다. 워크스페이스 밖이면 null —
 * 업무 프로젝트 브리프만 남고 세션은 평소대로 열린다.
 */
export async function buildWorkspaceBrief(
  rootPath: string,
  snapshot: WorkspaceSnapshot,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  const style = pathStyleFor(platform);
  const ref = resolveShellRefForPath(
    rootPath,
    { roots: snapshot.registry.roots, repoOwners: snapshot.repoOwners },
    style,
  );
  if (!ref) return null;
  const shell = snapshot.shells.find((candidate) => candidate.ref === ref);
  if (!shell) return null;

  const owner = snapshot.registry.roots.find((candidate) => candidate.work === shell.root);
  const datasetPaths = shell.data.length > 0 && owner ? await readDatasetPaths(owner.data) : {};
  return renderWorkspaceBrief({
    shell,
    rootPrinciplesPath: path.join(shell.root, "CLAUDE.md"),
    // 레포는 dev 루트에 평탄 배치된다(루트 §10). 루트 밖 레포는 셸이 절대경로로 들고 있다.
    siblingRepos: [
      ...shell.repos.map((name) => ({ name, path: path.join(owner?.dev ?? shell.root, name) })),
      ...shell.externalPaths.map((external) => ({ name: path.basename(external), path: external })),
    ],
    // 형제는 같은 묶음 라벨 + 같은 휴면 상태다. v1의 "같은 채널"보다 약간 넓지만(같은 라벨을 쓰는
    // 채널 둘이 한데 선다) v2에는 채널이 없고 `channel`은 모든 Project에 `"projects"`라 쓸 수 없다.
    siblingProjects:
      shell.groupLabel.length === 0
        ? []
        : snapshot.shells
            .filter(
              (candidate) =>
                candidate.groupLabel === shell.groupLabel &&
                candidate.archived === shell.archived &&
                candidate.ref !== shell.ref,
            )
            .map((candidate) => ({ title: candidate.title, ref: candidate.ref, path: candidate.path })),
    datasets: shell.data.map((id) => ({ id, path: datasetPaths[id] ?? null })),
    dataNotes: await readHead(path.join(shell.path, "wiki", "data.md"), DATA_NOTE_LINES),
  });
}
