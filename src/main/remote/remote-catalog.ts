import type { AgentView } from "../../shared/agent-types";
import type { SharedProject } from "../../shared/project-types";
import type { RemoteCatalog } from "../../shared/remote-types";
import { isWorkingBranch } from "../../shared/working-branches";
import type { SharedWorktree } from "../../shared/worktree-types";

type CatalogProject = Pick<SharedProject, "id" | "displayName" | "rootPath" | "hidden" | "order">;
type CatalogWorktree = Pick<SharedWorktree, "id" | "projectId" | "branch" | "createdAt">;

/** 표시 이름이 없는 폴더는 디렉터리 이름으로 부른다. 호스트가 Windows든 Linux든 마지막 조각이다. */
function folderName(project: CatalogProject): string {
  if (project.displayName) return project.displayName;
  const parts = project.rootPath.split(/[\\/]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? project.rootPath;
}

/** 디스크에 폴더가 남아 있는 워크트리만. 지운 워크트리로 세션을 띄우면 셸이 시작하자마자 죽는다. */
export async function existingWorktrees<T extends Pick<SharedWorktree, "path">>(
  worktrees: readonly T[],
  exists: (path: string) => Promise<boolean>,
): Promise<T[]> {
  const present = await Promise.all(worktrees.map((worktree) => exists(worktree.path)));
  return worktrees.filter((_, index) => present[index]);
}

/**
 * 원격 클라이언트가 새 세션을 띄울 때 고르는 것들. 숨긴 폴더와 이 PC에 실행 파일이 없는 에이전트는
 * 고를 수 없으니 싣지 않는다. 폴더는 사용자가 정한 순서가 먼저고, 순서가 없는 것은 이름순이다.
 *
 * 폴더마다 그 워크트리를 만든 순서로 붙인다. 사이드바처럼 봇 브랜치(dependabot 등)의 워크트리는
 * 뺀다. 디스크에서 사라진 워크트리는 부르는 쪽이 미리 걸러 넘긴다.
 */
export function buildRemoteCatalog(
  projects: readonly CatalogProject[],
  agents: ReadonlyArray<Pick<AgentView, "id" | "label" | "available">>,
  worktrees: readonly CatalogWorktree[] = [],
): RemoteCatalog {
  const worktreesOf = (projectId: string) =>
    worktrees
      .filter((worktree) => worktree.projectId === projectId && isWorkingBranch(worktree.branch))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((worktree) => ({ id: worktree.id, branch: worktree.branch }));
  return {
    projects: projects
      .filter((project) => !project.hidden)
      .map((project) => ({ id: project.id, name: folderName(project), order: project.order }))
      .sort((a, b) => {
        if (a.order !== null && b.order !== null && a.order !== b.order) return a.order - b.order;
        if (a.order !== null && b.order === null) return -1;
        if (a.order === null && b.order !== null) return 1;
        return a.name.localeCompare(b.name, "ko");
      })
      .map(({ id, name }) => ({ id, name, worktrees: worktreesOf(id) })),
    agents: agents.filter((agent) => agent.available).map((agent) => ({ id: agent.id, label: agent.label })),
  };
}
