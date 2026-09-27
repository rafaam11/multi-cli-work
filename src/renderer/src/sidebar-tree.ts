import type { SharedProject } from "@shared/project-types";
import type { WorkProject } from "@shared/work-project-types";

/**
 * 사이드바 트리의 모양을 만드는 순수 함수들 — 태그 묶음 › 프로젝트 › 폴더 딱 3단이다. 폴더는 잎이라
 * 접히지 않으므로, 여기서 다루는 접힘 대상은 묶음과 업무 프로젝트뿐이다.
 */

/** 트리의 한 묶음 — 업무 프로젝트 하나(또는 미분류)와 그 아래 폴더들. */
export interface TreeSection {
  key: string;
  workProject: WorkProject | null;
  projects: SharedProject[];
}

/** 태그 하나로 모은 줄. `tag: null`은 어느 고른 태그에도 걸리지 않은 것들을 받는 나머지 묶음이다. */
export interface TagGroupNode {
  kind: "group";
  key: string;
  tag: string | null;
  label: string;
  sections: TreeSection[];
}

/**
 * 접힘 키의 앞가지. 사이드바의 `expandedWorkspaces`에는 묶음 키도 프로젝트 키도 함께 살기 때문에,
 * "묶음 키만 골라내기"는 이 접두사 하나로 끝난다. 나머지 묶음은 태그 이름이 없으므로 접두사가 곧 키다.
 */
export const GROUP_KEY_PREFIX = "tag:";
export const OTHER_GROUP_KEY = GROUP_KEY_PREFIX;
/**
 * 미일치 묶음의 이름은 `기타`가 **아니다**: `기타`는 ws-root Z_ 채널이 심는 실제 태그이고
 * `LEGACY_LABEL_ORDER`에도 들어 있어, 두 이름이 같으면 이름도 토글 접근성 이름도 똑같은 형제
 * 줄이 나란히 선다. 태그가 아닌 자리라는 뜻만 남기고 이름은 겹치지 않게 `나머지`로 둔다.
 */
export const OTHER_GROUP_LABEL = "나머지";

/** 최상위 줄은 태그 묶음이거나, 묶음에 들지 않는 묶음(미분류) 하나다. */
export type TreeNode = TagGroupNode | { kind: "section"; key: string; section: TreeSection };

/** 무엇으로 묶을지와, 어느 업무 프로젝트가 무슨 태그를 가졌는지. 둘은 늘 함께 쓰인다. */
export interface TreeGrouping {
  tags: readonly string[];
  tagsByWorkProject: Readonly<Record<string, readonly string[]>>;
}

/**
 * 옛 ws-root 채널 라벨의 고정 순서. 기본 묶기가 이 라벨들을 **앞으로** 세우기 때문에, 채널 층이
 * 있던 때의 화면 순서가 그대로 보존된다(루트 CLAUDE.md §1의 채널 어휘). v2 PRJ 구조의 컨텍스트
 * 라벨은 사용자 데이터라 여기 적지 않는다 — 스냅샷에 나온 순서를 그대로 따른다.
 */
export const LEGACY_LABEL_ORDER = ["과제", "용역", "연구", "기타", "개인"] as const;

/**
 * Sidebar sections: one per work project plus a trailing 미분류 bucket. With no work projects at
 * all, the single unlabeled section keeps the tree exactly as it was before grouping existed.
 */
export function buildTreeSections(
  workProjects: readonly WorkProject[],
  projects: readonly SharedProject[],
  projectMembership: Record<string, { workProjectId: string }>,
): TreeSection[] {
  const sections = workProjects.map((workProject) => ({
    key: workProject.id,
    workProject: workProject as WorkProject | null,
    projects: projects.filter((project) => projectMembership[project.id]?.workProjectId === workProject.id),
  }));
  const unassigned = projects.filter((project) => !projectMembership[project.id]);
  if (unassigned.length > 0 || sections.length === 0) {
    sections.push({ key: "unassigned", workProject: null, projects: unassigned });
  }
  return sections;
}

/**
 * 태그 한 겹을 얹는다. 고른 태그를 그 순서대로 훑어 **첫 번째로 걸리는 묶음** 아래에 한 번만
 * 세우고, 하나도 걸리지 않으면 나머지 묶음이다. 묶음은 **그 묶음의 첫 구성원이 있던 자리**를
 * 차지하므로, 정렬해 둔 순서가 통째로 뒤집히지 않는다 — 다만 나머지는 언제나 맨 뒤다.
 *
 * 미분류(어느 업무 프로젝트에도 안 든 폴더)는 묶음 밖 최상위에, 나머지보다도 뒤에 남는다:
 * 미분류는 폴더 이야기고 나머지는 업무 프로젝트 이야기라 섞지 않는다. 고른 태그가 하나도 없으면
 * 묶음 자체가 서지 않고 모든 줄이 최상위 섹션이 된다.
 */
export function buildTreeNodes(sections: readonly TreeSection[], grouping: TreeGrouping): TreeNode[] {
  if (grouping.tags.length === 0) {
    return sections.map((section) => ({ kind: "section" as const, key: section.key, section }));
  }
  const nodes: TreeNode[] = [];
  const groups = new Map<string, TagGroupNode>();
  const trailing: TreeNode[] = [];
  let other: TagGroupNode | null = null;
  for (const section of sections) {
    const workProject = section.workProject;
    if (!workProject) {
      trailing.push({ kind: "section", key: section.key, section });
      continue;
    }
    const own = grouping.tagsByWorkProject[workProject.id] ?? [];
    const tag = grouping.tags.find((candidate) => own.includes(candidate)) ?? null;
    if (tag === null) {
      // 나머지는 자리를 잡지 않는다 — 맨 뒤에 서므로 여기서는 모으기만 한다.
      other ??= { kind: "group", key: OTHER_GROUP_KEY, tag: null, label: OTHER_GROUP_LABEL, sections: [] };
      other.sections.push(section);
      continue;
    }
    let group = groups.get(tag);
    if (!group) {
      group = { kind: "group", key: `${GROUP_KEY_PREFIX}${tag}`, tag, label: tag, sections: [] };
      groups.set(tag, group);
      nodes.push(group);
    }
    group.sections.push(section);
  }
  if (other) nodes.push(other);
  return [...nodes, ...trailing];
}

/** 트리에 서 있는 묶음들의 키. "모두"와 "접기"가 한꺼번에 여닫을 대상이다. */
export function groupKeys(nodes: readonly TreeNode[]): string[] {
  return nodes.flatMap((node) => (node.kind === "group" ? [node.key] : []));
}

/** "작업중"이 접을 묶음 키 — 작업중 폴더를 하나도 갖지 않은 묶음. */
export function collapsedGroupKeysForWorking(
  nodes: readonly TreeNode[],
  workingProjectIds: ReadonlySet<string>,
): Set<string> {
  const collapsed = new Set<string>();
  for (const node of nodes) {
    if (node.kind !== "group") continue;
    const hasWorking = node.sections.some((section) =>
      section.projects.some((project) => workingProjectIds.has(project.id)),
    );
    if (!hasWorking) collapsed.add(node.key);
  }
  return collapsed;
}

/**
 * 워크스페이스가 심어 주는 묶음 라벨을 기본 묶기 순서로 정렬한다. 옛 채널 라벨이 먼저, 나머지는
 * 처음 나온 순서대로. 빈 라벨(컨텍스트 미기재)은 묶을 이름이 없으므로 빠진다.
 */
export function orderWorkspaceLabels(shells: readonly { groupLabel: string }[]): string[] {
  const seen: string[] = [];
  for (const shell of shells) {
    if (shell.groupLabel.length > 0 && !seen.includes(shell.groupLabel)) seen.push(shell.groupLabel);
  }
  const rank = (label: string) => {
    const index = LEGACY_LABEL_ORDER.indexOf(label as (typeof LEGACY_LABEL_ORDER)[number]);
    return index < 0 ? LEGACY_LABEL_ORDER.length : index;
  };
  return seen
    .map((label, index) => ({ label, index }))
    .sort((left, right) => rank(left.label) - rank(right.label) || left.index - right.index)
    .map((entry) => entry.label);
}

/**
 * 저장된 선호가 없을 때 도는 묶기. 워크스페이스가 심어 둔 라벨 중 **실제로 붙어 있는 것만** 준
 * 순서대로 쓰고, 라벨이 없으면 묶지 않는다 — 이 기능이 없던 때와 같은 평면 트리다. 렌더마다
 * 파생하는 값이라 저장하지 않으며, 사용자가 한 번 고르면 그때부터 저장된 값이 이긴다.
 */
export function defaultGroupingTags(
  tagsByWorkProject: Readonly<Record<string, readonly string[]>>,
  orderedLabels: readonly string[],
): string[] {
  const present = new Set(Object.values(tagsByWorkProject).flatMap((tags) => [...tags]));
  return orderedLabels.filter((label) => present.has(label));
}
