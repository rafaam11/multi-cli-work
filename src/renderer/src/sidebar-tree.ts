import type { SharedProject } from "@shared/project-types";
import type { WorkProject } from "@shared/work-project-types";
import type { WorkspaceShellInfo } from "@shared/workspace-types";

/**
 * 사이드바 트리의 모양을 만드는 순수 함수들 — 채널 › 프로젝트 › 폴더 딱 3단이다. 폴더는 잎이라
 * 접히지 않으므로, 여기서 다루는 접힘 대상은 채널과 업무 프로젝트뿐이다.
 */

/** 트리의 한 묶음 — 업무 프로젝트 하나(또는 미분류)와 그 아래 폴더들. */
export interface TreeSection {
  key: string;
  workProject: WorkProject | null;
  projects: SharedProject[];
}

export interface ChannelNode {
  kind: "channel";
  key: string;
  channel: string;
  letter: string;
  label: string;
  sections: TreeSection[];
}

/** 최상위 줄은 채널 묶음이거나, 채널에 속하지 않는 묶음 하나다. */
export type TreeNode = ChannelNode | { kind: "section"; key: string; section: TreeSection };

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
 * 채널 한 겹을 얹는다. 워크스페이스 셸에서 만들어진 업무 프로젝트만 자기 채널 아래로 들어가고,
 * 손으로 만든 업무 프로젝트와 미분류는 있던 자리에 그대로 남는다. 채널 묶음은 **그 채널의 첫
 * 항목이 있던 자리**를 차지하므로, 정렬해 둔 순서가 통째로 뒤집히지 않는다.
 */
export function buildTreeNodes(
  sections: readonly TreeSection[],
  workspaceShells: Record<string, WorkspaceShellInfo>,
): TreeNode[] {
  const nodes: TreeNode[] = [];
  const channelNodes = new Map<string, ChannelNode>();
  for (const section of sections) {
    const shell = section.workProject ? workspaceShells[section.workProject.id] : undefined;
    if (!shell) {
      nodes.push({ kind: "section", key: section.key, section });
      continue;
    }
    let channel = channelNodes.get(shell.channel);
    if (!channel) {
      channel = {
        kind: "channel",
        key: `channel:${shell.channel}`,
        channel: shell.channel,
        letter: shell.channelLetter,
        label: shell.channelLabel,
        sections: [],
      };
      channelNodes.set(shell.channel, channel);
      nodes.push(channel);
    }
    channel.sections.push(section);
  }
  return nodes;
}

/** 트리에 서 있는 채널들의 키. "모두"와 "접기"가 한꺼번에 여닫을 대상이다. */
export function channelKeys(nodes: readonly TreeNode[]): string[] {
  return nodes.flatMap((node) => (node.kind === "channel" ? [node.key] : []));
}

/** "작업중"이 접을 채널 키 — 작업중 폴더를 하나도 갖지 않은 채널. */
export function collapsedChannelKeysForWorking(
  nodes: readonly TreeNode[],
  workingProjectIds: ReadonlySet<string>,
): Set<string> {
  const collapsed = new Set<string>();
  for (const node of nodes) {
    if (node.kind !== "channel") continue;
    const hasWorking = node.sections.some((section) =>
      section.projects.some((project) => workingProjectIds.has(project.id)),
    );
    if (!hasWorking) collapsed.add(node.key);
  }
  return collapsed;
}
