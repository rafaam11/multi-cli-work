import type { AgentView } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { WorkProject } from "@shared/work-project-types";
import { isWorkingBranch } from "@shared/working-branches";
import type { GitWorkspaceView } from "@shared/worktree-types";
import type { QuickOpenItem } from "../quick-open";
import { newSessionLabel, projectName, sessionLabel } from "../session-labels";

export interface QuickOpenSources {
  sessions: readonly TerminalSessionView[];
  projects: readonly SharedProject[];
  workspaceViews: readonly GitWorkspaceView[];
  workProjects: readonly WorkProject[];
  tagsByWorkProjectId: Readonly<Record<string, readonly string[]>>;
  agents: readonly AgentView[];
  /** 새 세션 명령을 붙일 폴더. 선택이 없거나 폴더가 디스크에서 사라졌으면 null. */
  selectedProject: SharedProject | null;
}

/** 빠른 열기(Ctrl+P) 목록: 최근 세션, 작업 위치, 폴더, 업무 프로젝트, 명령 순. */
export function buildQuickOpenItems(sources: QuickOpenSources): QuickOpenItem[] {
  const { sessions, projects, workspaceViews, workProjects, tagsByWorkProjectId, agents, selectedProject } = sources;
  const nameById = new Map(projects.map((project) => [project.id, projectName(project)]));
  const sessionItems = [...sessions]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((session): QuickOpenItem => ({
      key: `session:${session.id}`,
      kind: "session",
      label: sessionLabel(
        session,
        sessions.filter((peer) => peer.projectId === session.projectId),
        agents,
      ),
      detail: session.projectId ? (nameById.get(session.projectId) ?? null) : "도구",
    }));
  const projectItems = projects.map(
    (project): QuickOpenItem => ({
      key: `project:${project.id}`,
      kind: "project",
      label: projectName(project),
      detail: project.rootPath,
    }),
  );
  const workspaceItems = workspaceViews.filter((workspace) => workspace.kind === "main" || isWorkingBranch(workspace.branch)).map((workspace): QuickOpenItem => ({
    key: workspace.kind === "main" ? `workspace:main:${workspace.projectId}` : `workspace:worktree:${workspace.worktreeId}`,
    kind: "workspace",
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
  const commandItems: QuickOpenItem[] = [
    { key: "command:home", kind: "command", label: "홈 대시보드 열기", detail: null },
    ...(selectedProject
      ? agents
          .filter((agent) => agent.available)
          .map(
            (agent): QuickOpenItem => ({
              key: `command:new-session:${agent.id}`,
              kind: "command",
              label: newSessionLabel(agent),
              detail: projectName(selectedProject),
            }),
          )
      : []),
    { key: "command:edit-agents", kind: "command", label: "에이전트 추가 (agents.json)", detail: null },
    { key: "command:check-updates", kind: "command", label: "업데이트 확인", detail: null },
    { key: "command:settings", kind: "command", label: "설정 열기", detail: null },
  ];
  return [...sessionItems, ...workspaceItems, ...projectItems, ...workProjectItems, ...commandItems];
}
