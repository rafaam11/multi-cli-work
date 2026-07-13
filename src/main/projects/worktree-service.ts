import type { SharedProject } from "../../shared/project-types";
import type { SharedWorktree, WorktreeRemovalResult } from "../../shared/worktree-types";
import { addGitWorktree, defaultWorktreePath, removeGitWorktree, worktreeChangedFileCount } from "./git-worktree";
import {
  addWorktreeEntry,
  readWorktreeRegistry,
  removeWorktreeEntry,
  type WorktreeRegistryOptions,
} from "./worktree-registry";

export interface WorktreeServiceOptions {
  registryPath?: string;
  getProject(projectId: string): Promise<SharedProject | null>;
  /** Stops and removes every session running inside the worktree. */
  removeWorktreeSessions(worktreeId: string): Promise<void>;
  idFactory(): string;
  now(): string;
}

export class WorktreeService {
  private readonly registryOptions: WorktreeRegistryOptions;

  constructor(private readonly options: WorktreeServiceOptions) {
    this.registryOptions = options.registryPath ? { registryPath: options.registryPath } : {};
  }

  async list(): Promise<SharedWorktree[]> {
    const registry = await readWorktreeRegistry(this.registryOptions);
    return Object.values(registry.worktrees).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async get(worktreeId: string): Promise<SharedWorktree | null> {
    const registry = await readWorktreeRegistry(this.registryOptions);
    return registry.worktrees[worktreeId] ?? null;
  }

  async create(projectId: string, branch: string): Promise<SharedWorktree> {
    const project = await this.options.getProject(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    const worktreePath = defaultWorktreePath(project.rootPath, branch);
    const existing = await this.list();
    if (existing.some((worktree) => worktree.path === worktreePath)) {
      throw new Error(`A worktree already uses ${worktreePath}`);
    }
    // git first: if it refuses (branch exists, not a repo…), nothing has been recorded yet.
    await addGitWorktree(project.rootPath, worktreePath, branch);
    const now = this.options.now();
    const worktree: SharedWorktree = {
      id: this.options.idFactory(),
      projectId,
      path: worktreePath,
      branch,
      createdAt: now,
      updatedAt: now,
    };
    await addWorktreeEntry(worktree, this.registryOptions);
    return worktree;
  }

  /**
   * Removal is staged so nothing is lost silently: uncommitted changes stop the flow before any
   * session is touched, and only after the caller re-confirms with `force` does git discard them.
   */
  async remove(worktreeId: string, force: boolean): Promise<WorktreeRemovalResult> {
    const worktree = await this.get(worktreeId);
    if (!worktree) throw new Error(`Unknown worktree: ${worktreeId}`);
    const project = await this.options.getProject(worktree.projectId);
    if (!project) throw new Error(`Unknown project: ${worktree.projectId}`);
    if (!force) {
      const changedFileCount = await worktreeChangedFileCount(worktree.path);
      if (changedFileCount > 0) {
        return {
          removed: false,
          reason: "dirty",
          message: `${worktree.branch}에 커밋되지 않은 변경 ${changedFileCount}개가 있습니다.`,
        };
      }
    }
    // Sessions must stop before git tries to delete the directory: on Windows a live process
    // whose cwd is inside the worktree keeps the directory undeletable.
    await this.options.removeWorktreeSessions(worktreeId);
    await removeGitWorktree(project.rootPath, worktree.path, force);
    await removeWorktreeEntry(worktreeId, this.options.now(), this.registryOptions);
    return { removed: true };
  }
}
