import type { SharedProject } from "@shared/project-types";
import type { WorkProject } from "@shared/work-project-types";

/** 프로젝트와 그 아래 폴더 목록을 구성한다. */

/** 트리의 한 묶음 — 업무 프로젝트 하나(또는 미분류)와 그 아래 폴더들. */
export interface TreeSection {
  key: string;
  workProject: WorkProject | null;
  projects: SharedProject[];
}

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
