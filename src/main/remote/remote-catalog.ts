import type { AgentView } from "../../shared/agent-types";
import type { SharedProject } from "../../shared/project-types";
import type { RemoteCatalog } from "../../shared/remote-types";

type CatalogProject = Pick<SharedProject, "id" | "displayName" | "rootPath" | "hidden" | "order">;

/** 표시 이름이 없는 폴더는 디렉터리 이름으로 부른다. 호스트가 Windows든 Linux든 마지막 조각이다. */
function folderName(project: CatalogProject): string {
  if (project.displayName) return project.displayName;
  const parts = project.rootPath.split(/[\\/]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? project.rootPath;
}

/**
 * 원격 클라이언트가 새 세션을 띄울 때 고르는 것들. 숨긴 폴더와 이 PC에 실행 파일이 없는 에이전트는
 * 고를 수 없으니 싣지 않는다. 폴더는 사용자가 정한 순서가 먼저고, 순서가 없는 것은 이름순이다.
 */
export function buildRemoteCatalog(
  projects: readonly CatalogProject[],
  agents: ReadonlyArray<Pick<AgentView, "id" | "label" | "available">>,
): RemoteCatalog {
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
      .map(({ id, name }) => ({ id, name })),
    agents: agents.filter((agent) => agent.available).map((agent) => ({ id: agent.id, label: agent.label })),
  };
}
