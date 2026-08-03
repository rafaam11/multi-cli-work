import type { ProjectStatus } from "./project-types";

/**
 * A work project ("업무 프로젝트") groups the folders that belong to one real-world engagement —
 * a government grant, an outsourcing contract, a product — together with the links that live
 * outside git: the Teams document folder and the Notion page.
 *
 * Lives in its own file (`~/.multi-cli-work/work-projects.json`) rather than as fields on
 * `projects.json`: the project registry's exact-keys parser makes any new field there break
 * downgrades. See docs/superpowers/specs/registry-contract.md §8. Membership is stored here
 * only — `SharedProject` is untouched and the projectId→workProject mapping is derived in memory.
 */
export type WorkProjectRole = "repo" | "docs";

export interface WorkProjectMember {
  /** References `SharedProject.id` in projects.json. Dangling references are ignored on read. */
  projectId: string;
  role: WorkProjectRole;
}

/** Suggested values for `WorkProject.category`; the field itself accepts any non-empty string. */
export const WORK_PROJECT_CATEGORIES = ["정부지원과제", "외주개발", "상품개발", "기타"] as const;

export interface WorkProject {
  id: string;
  name: string;
  category: string;
  status: ProjectStatus | null;
  memo: string;
  notionUrl: string | null;
  /** Single source of truth for membership. A folder belongs to at most one work project. */
  members: WorkProjectMember[];
  order: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkProjectRegistryV1 {
  schemaVersion: 1;
  updatedAt: string;
  /**
   * The user's Teams (OneDrive-synced) root folder. Default location for the "docs" folder picker,
   * and the base future exports derive relative paths from. Lives here rather than in state.json:
   * that file's exact-keys parser would make the new field break downgrades, while this file is
   * new as a whole and old builds simply ignore it.
   */
  teamsSyncRoot: string | null;
  workProjects: Record<string, WorkProject>;
}
