import type { AgentView } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { WorkProject } from "@shared/work-project-types";
import { isWorkingBranch } from "@shared/working-branches";
import type { GitWorkspaceView } from "@shared/worktree-types";
import type { QuickOpenItem } from "../quick-open";
import { projectName, sessionLabel } from "../session-labels";

export interface QuickOpenSources {
  sessions: readonly TerminalSessionView[];
  projects: readonly SharedProject[];
  workspaceViews: readonly GitWorkspaceView[];
  workProjects: readonly WorkProject[];
  tagsByWorkProjectId: Readonly<Record<string, readonly string[]>>;
  agents: readonly AgentView[];
}

/**
 * 빠른 열기(Ctrl+P)의 이동 대상: 최근 세션, 작업 위치, 폴더, 업무 프로젝트 순. 명령은 여기 없다 —
 * `commands.ts`의 `buildCommandItems`가 레지스트리에서 만들고 명령 팔레트(Ctrl+Shift+P)만 보여 준다.
 */
export function buildQuickOpenItems(sources: QuickOpenSources): QuickOpenItem[] {
  const { sessions, projects, workspaceViews, workProjects, tagsByWorkProjectId, agents } = sources;
  const nameById = new Map(projects.map((project) => [project.id, projectName(project)]));
  const sessionItems = [...sessions]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((session): QuickOpenItem => ({
      key: `session:${session.id}`,
      kind: "session",
      projectId: session.projectId,
      agentId: session.kind,
      label: sessionLabel(
        session,
        sessions.filter((peer) => peer.projectId === session.projectId),
        agents,
      ),
      detail: session.projectId ? [nameById.get(session.projectId), workspaceViews.find(view => view.worktreeId && view.worktreeId === session.worktreeId)?.branch].filter(Boolean).join(" · ") : "도구",
    }));
  const projectItems = projects.map(
    (project): QuickOpenItem => ({
      key: `project:${project.id}`,
      kind: "project",
      projectId: project.id,
      label: projectName(project),
      detail: project.rootPath,
    }),
  );
  const workspaceItems = workspaceViews.filter((workspace) => workspace.kind === "main" || isWorkingBranch(workspace.branch)).map((workspace): QuickOpenItem => ({
    key: workspace.kind === "main" ? `workspace:main:${workspace.projectId}` : `workspace:worktree:${workspace.worktreeId}`,
    kind: "workspace",
    projectId: workspace.projectId,
    label: workspace.kind === "main" ? `${nameById.get(workspace.projectId) ?? "프로젝트"} · 메인` : workspace.branch ?? `detached @ ${workspace.head?.slice(0, 7) ?? "unknown"}`,
    detail: workspace.path,
  }));
  const workProjectItems = workProjects.map(
    (workProject): QuickOpenItem => ({
      key: `work-project:${workProject.id}`,
      kind: "workProject",
      label: workProject.name,
      detail: (tagsByWorkProjectId[workProject.id] ?? []).map((tag) => `#${tag}`).join(" ") || null,
    }),
  );
  return [...sessionItems, ...workspaceItems, ...projectItems, ...workProjectItems];
}
