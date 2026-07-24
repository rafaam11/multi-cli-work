import type { SharedProject } from "../../shared/project-types";
import type {
  GitWorkspaceView,
  SharedWorktree,
  WorktreeCreateOptions,
  WorktreeCreateRequest,
  WorktreeRemovalResult,
  WorktreeWorkspaceSnapshot,
} from "../../shared/worktree-types";
import {
  addGitWorktree,
  addGitWorktreeRequest,
  gitCommonDir,
  listGitWorktrees,
  nextAvailableWorktreePath,
  normalizeWorkspacePath,
  pruneGitWorktrees,
  removeGitWorktree,
  unlockGitWorktree,
  worktreeChangedFileCount,
} from "./git-worktree";
import {
  addWorktreeEntry,
  readWorktreeRegistry,
  replaceWorktreeEntries,
  removeWorktreeEntry,
  type WorktreeRegistryOptions,
} from "./worktree-registry";

export interface WorktreeServiceOptions {
  registryPath?: string;
  getProject(projectId: string): Promise<SharedProject | null>;
  /** Stops and removes every session running inside the worktree. */
  removeWorktreeSessions(worktreeId: string): Promise<void>;
  hasWorktreeSessions?(worktreeId: string): boolean | Promise<boolean>;
  idFactory(): string;
  now(): string;
}

export class WorktreeService {
  private readonly registryOptions: WorktreeRegistryOptions;
  private syncPromise: Promise<WorktreeWorkspaceSnapshot> | null = null;
  private lastProjects: SharedProject[] = [];

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

  sync(projects: SharedProject[]): Promise<WorktreeWorkspaceSnapshot> {
    this.lastProjects = projects;
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.performSync(projects).finally(() => {
      this.syncPromise = null;
    });
    return this.syncPromise;
  }

  private async performSync(projects: SharedProject[]): Promise<WorktreeWorkspaceSnapshot> {
    const registry = await readWorktreeRegistry(this.registryOptions);
    const entries = { ...registry.worktrees };
    const workspaces: GitWorkspaceView[] = [];
    const warnings: Record<string, string> = {};
    let changed = false;

    const owners = new Map<string, SharedProject>();
    const commonDirs = new Map<string, string>();
    for (const project of [...projects].sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
      try {
        const common = normalizeWorkspacePath(await gitCommonDir(project.rootPath));
        commonDirs.set(project.id, common);
        if (!owners.has(common)) owners.set(common, project);
      } catch {
        // The project-level list below produces the user-facing warning.
      }
    }
    for (const project of projects) {
      try {
        const common = commonDirs.get(project.id);
        const owner = common ? owners.get(common) : undefined;
        if (owner && owner.id !== project.id) {
          warnings[project.id] = `같은 Git 저장소는 ${owner.displayName ?? owner.rootPath} 프로젝트가 관리합니다.`;
          continue;
        }
        const listed = await listGitWorktrees(project.rootPath);
        const mainKey = normalizeWorkspacePath(project.rootPath);
        const seen = new Set<string>();
        for (const item of listed) {
          const normalized = normalizeWorkspacePath(item.path);
          seen.add(normalized);
          const isMain = normalized === mainKey;
          let worktreeId: string | null = null;
          if (!isMain) {
            const existing = Object.values(entries).find(
              (entry) => entry.projectId === project.id && normalizeWorkspacePath(entry.path) === normalized,
            );
            if (existing) worktreeId = existing.id;
            else {
              const now = this.options.now();
              const entry: SharedWorktree = {
                id: this.options.idFactory(),
                projectId: project.id,
                path: item.path,
                branch: item.branch ?? "detached",
                createdAt: now,
                updatedAt: now,
              };
              entries[entry.id] = entry;
              worktreeId = entry.id;
              changed = true;
            }
          }
          workspaces.push({
            workspaceKey: isMain ? `project:${project.id}:main` : `worktree:${worktreeId}`,
            kind: isMain ? "main" : "worktree",
            projectId: project.id,
            worktreeId,
            path: item.path,
            branch: item.branch,
            head: item.head,
            changedFileCount: item.prunableReason ? 0 : await worktreeChangedFileCount(item.path),
            availability: "available",
            lockedReason: item.lockedReason,
            prunableReason: item.prunableReason,
          });
        }
        for (const entry of Object.values(entries)) {
          if (entry.projectId !== project.id || seen.has(normalizeWorkspacePath(entry.path))) continue;
          workspaces.push({
            workspaceKey: `worktree:${entry.id}`,
            kind: "worktree",
            projectId: project.id,
            worktreeId: entry.id,
            path: entry.path,
            branch: entry.branch === "detached" ? null : entry.branch,
            head: null,
            changedFileCount: 0,
            availability: "missing",
            lockedReason: null,
            prunableReason: "Git no longer reports this worktree",
          });
        }
      } catch (error) {
        warnings[project.id] = error instanceof Error ? error.message : String(error);
      }
    }
    if (changed) await replaceWorktreeEntries(entries, this.options.now(), this.registryOptions);
    return { workspaces, warnings };
  }

  async ownerForPath(rootPath: string, projects: SharedProject[]): Promise<{ projectId: string; worktreeId: string | null } | null> {
    let candidateCommon: string;
    try { candidateCommon = normalizeWorkspacePath(await gitCommonDir(rootPath)); } catch { return null; }
    const matches: SharedProject[] = [];
    for (const project of projects) {
      try {
        if (normalizeWorkspacePath(await gitCommonDir(project.rootPath)) === candidateCommon) matches.push(project);
      } catch { /* not a repository */ }
    }
    const owner = matches.sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (!owner) return null;
    const snapshot = await this.sync(projects);
    const workspace = snapshot.workspaces.find(
      (item) => item.projectId === owner.id && normalizeWorkspacePath(item.path) === normalizeWorkspacePath(rootPath),
    );
    return { projectId: owner.id, worktreeId: workspace?.worktreeId ?? null };
  }

  async previewPath(projectId: string, branch: string): Promise<string> {
    const project = await this.options.getProject(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    return nextAvailableWorktreePath(project.rootPath, branch);
  }

  async creationOptions(projectId: string): Promise<WorktreeCreateOptions> {
    const project = await this.options.getProject(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const result = await run(
      "git",
      ["-C", project.rootPath, "for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"],
      { windowsHide: true, timeout: 5_000 },
    );
    const refs = result.stdout.split(/\r?\n/).filter(Boolean);
    const localBranches = refs.filter((ref) => ref.startsWith("refs/heads/")).map((ref) => ref.slice(11));
    const remoteBranches = refs
      .filter((ref) => ref.startsWith("refs/remotes/") && !ref.endsWith("/HEAD"))
      .map((ref) => ref.slice(13));
    const listed = await listGitWorktrees(project.rootPath);
    const checkedOutBranches = listed.flatMap((item) => (item.branch ? [item.branch] : []));
    const main = listed.find(
      (item) => normalizeWorkspacePath(item.path) === normalizeWorkspacePath(project.rootPath),
    );
    return {
      localBranches: localBranches.sort(),
      remoteBranches: remoteBranches.sort(),
      checkedOutBranches,
      defaultStartPoint: main?.branch ?? main?.head ?? "HEAD",
    };
  }

  async create(projectId: string, request: string | WorktreeCreateRequest): Promise<SharedWorktree> {
    const project = await this.options.getProject(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    const normalizedRequest: WorktreeCreateRequest =
      typeof request === "string" ? { kind: "new", branch: request, startPoint: "HEAD" } : request;
    const branch = normalizedRequest.kind === "remote" ? normalizedRequest.localBranch : normalizedRequest.branch;
    const existing = await this.list();
    if (existing.some((worktree) => worktree.projectId === projectId && worktree.branch === branch)) {
      throw new Error(`A worktree already uses branch ${branch}`);
    }
    const worktreePath = await nextAvailableWorktreePath(project.rootPath, branch);
    if (existing.some((worktree) => worktree.path === worktreePath)) {
      throw new Error(`A worktree already uses ${worktreePath}`);
    }
    // git first: if it refuses (branch exists, not a repo…), nothing has been recorded yet.
    if (typeof request === "string") await addGitWorktree(project.rootPath, worktreePath, branch);
    else await addGitWorktreeRequest(project.rootPath, worktreePath, normalizedRequest);
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
    if (this.lastProjects.length > 0) await this.sync(this.lastProjects);
    return worktree;
  }

  async unlock(worktreeId: string): Promise<void> {
    const worktree = await this.get(worktreeId);
    if (!worktree) throw new Error(`Unknown worktree: ${worktreeId}`);
    const project = await this.options.getProject(worktree.projectId);
    if (!project) throw new Error(`Unknown project: ${worktree.projectId}`);
    await unlockGitWorktree(project.rootPath, worktree.path);
    if (this.lastProjects.length > 0) await this.sync(this.lastProjects);
  }

  async cleanupStale(projectId: string): Promise<WorktreeWorkspaceSnapshot> {
    const project = await this.options.getProject(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    const listed = await listGitWorktrees(project.rootPath);
    const activePaths = new Set(listed.map((item) => normalizeWorkspacePath(item.path)));
    const registry = await readWorktreeRegistry(this.registryOptions);
    const entries = { ...registry.worktrees };
    for (const entry of Object.values(entries)) {
      if (entry.projectId !== projectId || activePaths.has(normalizeWorkspacePath(entry.path))) continue;
      if (await this.options.hasWorktreeSessions?.(entry.id)) continue;
      delete entries[entry.id];
    }
    await replaceWorktreeEntries(entries, this.options.now(), this.registryOptions);
    await pruneGitWorktrees(project.rootPath);
    return this.sync(this.lastProjects.length > 0 ? this.lastProjects : [project]);
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
    const listed = await listGitWorktrees(project.rootPath);
    const state = listed.find(
      (item) => normalizeWorkspacePath(item.path) === normalizeWorkspacePath(worktree.path),
    );
    if (state?.lockedReason) throw new Error("Locked worktree must be unlocked before removal");
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
    if (this.lastProjects.length > 0) await this.sync(this.lastProjects);
    return { removed: true };
  }
}
