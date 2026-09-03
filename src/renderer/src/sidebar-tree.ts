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

/** 태그 하나로 모은 줄. `tag: null`은 어느 고른 태그에도 걸리지 않은 것들을 받는 기타 묶음이다. */
export interface TagGroupNode {
  kind: "group";
  key: string;
  tag: string | null;
  label: string;
  sections: TreeSection[];
}

/**
 * 접힘 키의 앞가지. 사이드바의 `expandedWorkspaces`에는 묶음 키도 프로젝트 키도 함께 살기 때문에,
 * "묶음 키만 골라내기"는 이 접두사 하나로 끝난다. 기타 묶음은 태그 이름이 없으므로 접두사가 곧 키다.
 */
export const GROUP_KEY_PREFIX = "tag:";
export const OTHER_GROUP_KEY = GROUP_KEY_PREFIX;
export const OTHER_GROUP_LABEL = "기타";

/** 최상위 줄은 태그 묶음이거나, 묶음에 들지 않는 묶음(미분류) 하나다. */
export type TreeNode = TagGroupNode | { kind: "section"; key: string; section: TreeSection };

/** 무엇으로 묶을지와, 어느 업무 프로젝트가 무슨 태그를 가졌는지. 둘은 늘 함께 쓰인다. */
export interface TreeGrouping {
  tags: readonly string[];
  tagsByWorkProject: Readonly<Record<string, readonly string[]>>;
}

/**
 * ws-root 채널 라벨의 고정 순서. 기본 묶기가 이 순서로 돌기 때문에, 업그레이드 직후의 화면이
 * 채널 층이 있던 때와 같아 보인다(루트 CLAUDE.md §1의 채널 어휘 그대로다).
 */
export const CHANNEL_LABEL_ORDER = ["과제", "용역", "연구", "기타", "개인"] as const;

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
 * 세우고, 하나도 걸리지 않으면 기타 묶음이다. 묶음은 **그 묶음의 첫 구성원이 있던 자리**를
 * 차지하므로, 정렬해 둔 순서가 통째로 뒤집히지 않는다 — 다만 기타는 언제나 맨 뒤다.
 *
 * 미분류(어느 업무 프로젝트에도 안 든 폴더)는 묶음 밖 최상위에, 기타보다도 뒤에 남는다:
 * 미분류는 폴더 이야기고 기타는 업무 프로젝트 이야기라 섞지 않는다. 고른 태그가 하나도 없으면
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
      // 기타는 자리를 잡지 않는다 — 맨 뒤에 서므로 여기서는 모으기만 한다.
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
 * 저장된 선호가 없을 때 도는 묶기. ws-root 셸이 하나라도 있으면 동기화가 심어 둔 채널 라벨
 * 태그들을 고정 순서로 쓰고, 셸이 없으면 묶지 않는다 — 이 기능이 없던 때와 같은 평면 트리다.
 * 렌더마다 파생하는 값이라 저장하지 않으며, 사용자가 한 번 고르면 그때부터 저장된 값이 이긴다.
 */
export function defaultGroupingTags(
  tagsByWorkProject: Readonly<Record<string, readonly string[]>>,
  hasWorkspaceShells: boolean,
): string[] {
  if (!hasWorkspaceShells) return [];
  const present = new Set(Object.values(tagsByWorkProject).flatMap((tags) => [...tags]));
  return CHANNEL_LABEL_ORDER.filter((label) => present.has(label));
}
