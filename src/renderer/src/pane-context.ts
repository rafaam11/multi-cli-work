import type { SharedProject } from "@shared/project-types";
import type { ProjectCategorySetting } from "@shared/settings-types";
import type { WorkProject } from "@shared/work-project-types";
import type { SharedWorktree } from "@shared/worktree-types";
import type { PaneOwner } from "./pane-items";
import { projectName } from "./session-labels";
import { categoryAccentClass } from "./work-project-accent";

/**
 * Where a pane's work lives, in the order its header spells it out. The folder comes first because
 * it is the one part that always tells two panes apart — a session name is whatever the provider or
 * the user made of it. The branch exists only for worktree sessions, and the 업무 프로젝트 comes last
 * because it is the part a narrow column can afford to drop.
 */
export interface PaneContext {
  folder: string;
  /** The worktree's branch, absent for a session at the folder root. */
  branch: string | null;
  /** The 업무 프로젝트 that owns the folder, absent for a 미분류 folder and for tool sessions. */
  workProject: string | null;
  /** The category colour class from work-project-accent, null when nothing owns the folder. */
  accentClass: string | null;
  /** Every part spelled out, for the header's title — the line itself gets truncated. */
  title: string;
  /** A maintenance session runs outside every folder, and says so with a different icon. */
  tool: boolean;
}

/** The registries a place is resolved against. App already keeps all four for the sidebar. */
export interface PaneContextSources {
  projects: readonly SharedProject[];
  worktrees: readonly SharedWorktree[];
  workProjects: readonly WorkProject[];
  /** projectId → owning work project, the map App derives from the memberships. */
  membership: Readonly<Record<string, { workProjectId: string }>>;
  /** 설정의 구분 목록 — 헤더 색은 여기서 찾고, 목록에 없는 구분은 회색이다. */
  categories: readonly ProjectCategorySetting[];
}

/** A folder that is no longer registered still names itself, from the directory the pane runs in. */
function folderFromPath(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd;
}

/**
 * A session's place. `projectId` is null for the maintenance sessions that update a CLI: they run
 * outside every folder, so they get the word the quick open palette already uses for them rather
 * than an empty line.
 */
export function paneContextOf(
  place: { projectId: string | null; worktreeId?: string; cwd: string },
  sources: PaneContextSources,
): PaneContext {
  if (place.projectId === null) {
    return { folder: "도구", branch: null, workProject: null, accentClass: null, title: "도구", tool: true };
  }
  const project = sources.projects.find((candidate) => candidate.id === place.projectId);
  const folder = project ? projectName(project) : folderFromPath(place.cwd);
  // A worktree the user has since removed leaves its id behind on the session. Name the folder on
  // its own rather than a branch that is no longer there.
  const worktree = place.worktreeId
    ? sources.worktrees.find((candidate) => candidate.id === place.worktreeId)
    : undefined;
  const owner = sources.membership[place.projectId];
  const workProject = owner
    ? sources.workProjects.find((candidate) => candidate.id === owner.workProjectId)
    : undefined;
  const parts = [folder, worktree?.branch, workProject?.name].filter((part): part is string => Boolean(part));
  return {
    folder,
    branch: worktree?.branch ?? null,
    workProject: workProject?.name ?? null,
    accentClass: workProject ? categoryAccentClass(workProject.category, sources.categories) : null,
    title: parts.join(" · "),
    tool: false,
  };
}

/**
 * A document's place. Documents hang under a folder or a worktree instead of carrying a projectId,
 * so the worktree case finds its folder first and then answers exactly the way a session does —
 * the rules for naming a place live in one function only.
 */
export function paneContextOfOwner(owner: PaneOwner | null, sources: PaneContextSources): PaneContext | null {
  if (!owner) return null;
  if (owner.kind === "project") {
    const project = sources.projects.find((candidate) => candidate.id === owner.id);
    return project ? paneContextOf({ projectId: project.id, cwd: project.rootPath }, sources) : null;
  }
  const worktree = sources.worktrees.find((candidate) => candidate.id === owner.id);
  if (!worktree) return null;
  return paneContextOf({ projectId: worktree.projectId, worktreeId: worktree.id, cwd: worktree.path }, sources);
}
