import type { TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { WorkProject, WorkProjectRole } from "@shared/work-project-types";
import { useMemo, useState } from "react";
import { isFolderActive } from "../folder-status";
import { COLLAPSED_PROJECTS_KEY, COLLAPSED_WORK_PROJECTS_KEY, persistCollapsed } from "./app-model";

export interface FolderTreeInput {
  projects: readonly SharedProject[];
  workProjects: readonly WorkProject[];
  sessions: readonly TerminalSessionView[];
  /** 폴더 id → 속한 업무 프로젝트. 없으면 미분류. */
  projectMembership: Readonly<Record<string, { workProjectId: string; role: WorkProjectRole }>>;
}

/**
 * 사이드바 트리에서 무엇이 펼쳐져 있는지. 폴더와 업무 프로젝트의 접힘은 localStorage에 남아 재시작
 * 뒤에도 그대로다. 일괄 펼치기·접기·작업중만 펼치기도 여기서 한다.
 */
export function useFolderTree({ projects, workProjects, sessions, projectMembership }: FolderTreeInput) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(COLLAPSED_PROJECTS_KEY) ?? "{}") as { collapsed?: string[] };
      return new Set(stored.collapsed ?? []);
    } catch { return new Set(); }
  });
  const [collapsedWorkProjectIds, setCollapsedWorkProjectIds] = useState<Set<string>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(COLLAPSED_WORK_PROJECTS_KEY) ?? "{}") as { collapsed?: string[] };
      return new Set(stored.collapsed ?? []);
    } catch { return new Set(); }
  });

  const expandedWorkProjects = useMemo(
    () => new Set(workProjects.filter((workProject) => !collapsedWorkProjectIds.has(workProject.id)).map((workProject) => workProject.id)),
    [workProjects, collapsedWorkProjectIds],
  );

  /**
   * 탐색으로 폴더를 펼치는 모든 길(선택·세션 드러내기·worktree·폴더 추가·이름 변경)이 지나는 한 곳.
   * 저장된 접힘도 함께 지운다 — 메모리에서만 펼치고 접힘을 남겨 두면 재시작이 그 폴더를 도로 접어,
   * 마지막으로 보던 세션 줄이 트리에서 사라진다(R13). 체버론·재클릭의 명시적 접기는 toggleProject가 맡는다.
   */
  const expandProject = (projectId: string) => {
    setExpandedProjects((current) => (current.has(projectId) ? current : new Set(current).add(projectId)));
    setCollapsedProjectIds((current) => {
      if (!current.has(projectId)) return current;
      const next = new Set(current);
      next.delete(projectId);
      persistCollapsed(COLLAPSED_PROJECTS_KEY, next);
      return next;
    });
  };

  const expandWorkProject = (workProjectId: string) => {
    setCollapsedWorkProjectIds((current) => {
      if (!current.has(workProjectId)) return current;
      const next = new Set(current);
      next.delete(workProjectId);
      persistCollapsed(COLLAPSED_WORK_PROJECTS_KEY, next);
      return next;
    });
  };

  const toggleProject = (projectId: string) => {
    setExpandedProjects((current) => {
      const next = new Set(current);
      const collapsed = new Set(collapsedProjectIds);
      if (next.has(projectId)) { next.delete(projectId); collapsed.add(projectId); }
      else { next.add(projectId); collapsed.delete(projectId); }
      setCollapsedProjectIds(collapsed);
      persistCollapsed(COLLAPSED_PROJECTS_KEY, collapsed);
      return next;
    });
  };

  const toggleWorkProject = (workProjectId: string) => {
    setCollapsedWorkProjectIds((current) => {
      const next = new Set(current);
      if (next.has(workProjectId)) next.delete(workProjectId);
      else next.add(workProjectId);
      persistCollapsed(COLLAPSED_WORK_PROJECTS_KEY, next);
      return next;
    });
  };

  /**
   * 두 층이 펼침을 다르게 갖는다 — 폴더는 저장된 접힘 집합과 나란히 펼침 집합을 들고 있고, 업무
   * 프로젝트의 펼침은 접힘 집합의 여집합이다. 그래서 일괄 동작은 각 층에서 "열어 둘 것"만 말하고
   * 나머지 채우기를 여기 맡긴다. 태그 묶음 층은 사이드바가 자기 키에 따로 적는다.
   */
  const applyExpansion = (expandedProjectIds: Set<string>, expandedWorkProjectIds: Set<string>) => {
    const collapsedProjects = new Set(
      projects.filter((project) => !expandedProjectIds.has(project.id)).map((project) => project.id),
    );
    const collapsedWorkProjects = new Set(
      workProjects.filter((workProject) => !expandedWorkProjectIds.has(workProject.id)).map((workProject) => workProject.id),
    );
    setExpandedProjects(expandedProjectIds);
    setCollapsedProjectIds(collapsedProjects);
    setCollapsedWorkProjectIds(collapsedWorkProjects);
    persistCollapsed(COLLAPSED_PROJECTS_KEY, collapsedProjects);
    persistCollapsed(COLLAPSED_WORK_PROJECTS_KEY, collapsedWorkProjects);
  };

  const expandAll = () =>
    applyExpansion(
      new Set(projects.map((project) => project.id)),
      new Set(workProjects.map((workProject) => workProject.id)),
    );

  const collapseAll = () => applyExpansion(new Set(), new Set());

  /** 작업중 폴더는 열어 두고, 그런 폴더를 아직 가진 업무 프로젝트도 함께. worktree 층은 건드리지 않는다. */
  const expandWorking = () => {
    const working = projects.filter((project) =>
      isFolderActive(sessions.filter((session) => session.projectId === project.id)),
    );
    applyExpansion(
      new Set(working.map((project) => project.id)),
      new Set(
        working
          .map((project) => projectMembership[project.id]?.workProjectId)
          .filter((workProjectId): workProjectId is string => workProjectId !== undefined),
      ),
    );
  };

  return {
    expandedProjects,
    setExpandedProjects,
    collapsedProjectIds,
    expandedWorkProjects,
    expandProject,
    expandWorkProject,
    toggleProject,
    toggleWorkProject,
    expandAll,
    collapseAll,
    expandWorking,
  };
}
