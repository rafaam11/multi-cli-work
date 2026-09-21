import type { SharedProject } from "../../shared/project-types";
import { runReadOnlyGit } from "./read-only-git";
import { isWorkingBranch } from "../../shared/working-branches";
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
  applyWorktreeEntryChanges,
  readWorktreeRegistry,
  removeWorktreeEntry,
  type WorktreeRegistryOptions,
} from "./worktree-registry";

export interface WorktreeServiceOptions {
  registryPath?: string;
  getProject(projectId: string): Promise<SharedProject | null>;
  /** Stops processes whose cwd would prevent Git from deleting the worktree. */
  stopWorktreeSessions(worktreeId: string): Promise<void>;
  /** Removes stopped session records and logs after Git has deleted the worktree. */
  removeWorktreeSessions(worktreeId: string): Promise<void>;
  hasWorktreeSessions?(worktreeId: string): boolean | Promise<boolean>;
  idFactory(): string;
  now(): string;
}

export class WorktreeService {
  private readonly registryOptions: WorktreeRegistryOptions;
  private syncPromise: Promise<WorktreeWorkspaceSnapshot> | null = null;
  private pendingSync: Promise<WorktreeWorkspaceSnapshot> | null = null;
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
    if (!this.syncPromise) return this.startSync(projects);
    // A sync begun before this call cannot see registry writes made since (worktree create),
    // so late callers get one coalesced re-run after it, over the latest projects.
    this.pendingSync ??= this.syncPromise
      .catch(() => undefined)
      .then(() => {
        this.pendingSync = null;
        return this.startSync(this.lastProjects);
      });
    return this.pendingSync;
  }

  private startSync(projects: SharedProject[]): Promise<WorktreeWorkspaceSnapshot> {
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
    const added: SharedWorktree[] = [];
    const updated: SharedWorktree[] = [];
    const removedIds: string[] = [];

    const owners = new Map<string, SharedProject>();
    const commonDirs = new Map<string, string>();
    const byAge = [...projects].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const queriedCommonDirs = await Promise.allSettled(byAge.map((project) => gitCommonDir(project.rootPath)));
    for (const [index, project] of byAge.entries()) {
      const result = queriedCommonDirs[index];
      if (result.status === "fulfilled") {
        const common = normalizeWorkspacePath(result.value);
        commonDirs.set(project.id, common);
        if (!owners.has(common)) owners.set(common, project);
      }
    }
    // Complete I/O concurrently, then apply results in input order: completion order must not
    // change generated worktree IDs, warning ownership, or the registry deltas.
    const queriedWorkspaces = await Promise.allSettled(projects.map(async (project) => {
      const common = commonDirs.get(project.id);
      const owner = common ? owners.get(common) : undefined;
      if (owner && owner.id !== project.id) return null;
      const listed = await listGitWorktrees(project.rootPath);
      const counts = await Promise.allSettled(listed.map((item) =>
        item.prunableReason ? Promise.resolve(0) : worktreeChangedFileCount(item.path),
      ));
      return { listed, counts };
    }));
    for (const [projectIndex, project] of projects.entries()) {
      try {
        const common = commonDirs.get(project.id);
        const owner = common ? owners.get(common) : undefined;
        if (owner && owner.id !== project.id) {
          warnings[project.id] = `같은 Git 저장소는 ${owner.displayName ?? owner.rootPath} 프로젝트가 관리합니다.`;
          continue;
        }
        const query = queriedWorkspaces[projectIndex];
        if (query.status === "rejected") throw query.reason;
        if (!query.value) continue;
        const { listed, counts } = query.value;
        const mainKey = normalizeWorkspacePath(project.rootPath);
        const seen = new Set<string>();
        for (const [itemIndex, item] of listed.entries()) {
          const normalized = normalizeWorkspacePath(item.path);
          seen.add(normalized);
          const isMain = normalized === mainKey;
          let worktreeId: string | null = null;
          if (!isMain) {
            const existing = Object.values(entries).find(
              (entry) => entry.projectId === project.id && normalizeWorkspacePath(entry.path) === normalized,
            );
            if (existing) {
              worktreeId = existing.id;
              const branch = item.branch ?? "detached";
              if (existing.branch !== branch) {
                const refreshed = { ...existing, branch, updatedAt: this.options.now() };
                entries[existing.id] = refreshed;
                updated.push(refreshed);
              }
            }
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
              added.push(entry);
            }
          }
          const count = counts[itemIndex];
          if (count.status === "rejected") throw count.reason;
          workspaces.push({
            workspaceKey: isMain ? `project:${project.id}:main` : `worktree:${worktreeId}`,
            kind: isMain ? "main" : "worktree",
            projectId: project.id,
            worktreeId,
            path: item.path,
            branch: item.branch,
            head: item.head,
            changedFileCount: count.value,
            availability: "available",
            lockedReason: item.lockedReason,
            prunableReason: item.prunableReason,
          });
        }
        for (const entry of Object.values(entries)) {
          if (entry.projectId !== project.id || seen.has(normalizeWorkspacePath(entry.path))) continue;
          if (!(await this.options.hasWorktreeSessions?.(entry.id))) {
            delete entries[entry.id];
            removedIds.push(entry.id);
            continue;
          }
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
    // Deltas instead of a full replace: the registry may have gained entries since it was read
    // at the top of this sync, and those must survive the write.
    if (added.length > 0 || updated.length > 0 || removedIds.length > 0) {
      await applyWorktreeEntryChanges({ added, updated, removedIds }, this.options.now(), this.registryOptions);
    }
    return { workspaces, warnings };
  }

  async ownerForPath(rootPath: string, projects: SharedProject[]): Promise<{ projectId: string; worktreeId: string | null } | null> {
    let candidateCommon: string;
    try { candidateCommon = normalizeWorkspacePath(await gitCommonDir(rootPath)); } catch { return null; }
    const commonDirs = await Promise.allSettled(projects.map((project) => gitCommonDir(project.rootPath)));
    const matches = projects.filter((_project, index) => {
      const result = commonDirs[index];
      return result.status === "fulfilled" && normalizeWorkspacePath(result.value) === candidateCommon;
    });
    const owner = matches.sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (!owner) return null;
    const snapshot = await this.sync(projects);
    const workspace = snapshot.workspaces.find(
      (item) => item.projectId === owner.id && normalizeWorkspacePath(item.path) === normalizeWorkspacePath(rootPath),
    );
    return { projectId: owner.id, worktreeId: workspace?.worktreeId ?? null };
  }

  async resolveSessionWorkspace(projectId: string, cwd: string, projects: SharedProject[]): Promise<{ cwd: string; worktreeId?: string } | null> {
    try {
      const { stdout } = await runReadOnlyGit(["-C", cwd, "rev-parse", "--show-toplevel"], { windowsHide: true, timeout: 5_000 });
      const root = stdout.trim();
      const project = projects.find((entry) => entry.id === projectId);
      if (!project || !root) return null;
      if (normalizeWorkspacePath(root) === normalizeWorkspacePath(project.rootPath)) return { cwd };
      const owner = await this.ownerForPath(root, projects);
      if (owner?.projectId !== projectId || !owner.worktreeId) return null;
      return { cwd, worktreeId: owner.worktreeId };
    } catch { return null; }
  }

  async previewPath(projectId: string, branch: string): Promise<string> {
    const project = await this.options.getProject(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    return nextAvailableWorktreePath(project.rootPath, branch);
  }

  async creationOptions(projectId: string): Promise<WorktreeCreateOptions> {
    const project = await this.options.getProject(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    const result = await runReadOnlyGit(
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
      localBranches: localBranches.filter(isWorkingBranch).sort(),
      remoteBranches: remoteBranches.filter((ref) => isWorkingBranch(ref.slice(ref.indexOf("/") + 1))).sort(),
      checkedOutBranches,
      defaultStartPoint: main?.branch ?? main?.head ?? "HEAD",
    };
  }

  async create(projectId: string, request: string | WorktreeCreateRequest): Promise<SharedWorktree> {
    const project = await this.options.getProject(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    const listed = await listGitWorktrees(project.rootPath);
    const actualBranches = new Map(
      listed.map((item) => [normalizeWorkspacePath(item.path), item.branch ?? "detached"]),
    );
    const registryEntries = await this.list();
    const refreshed = registryEntries.flatMap((entry) => {
      if (entry.projectId !== projectId) return [];
      const branch = actualBranches.get(normalizeWorkspacePath(entry.path));
      if (!branch || branch === entry.branch) return [];
      return [{ ...entry, branch, updatedAt: this.options.now() }];
    });
    if (refreshed.length > 0) {
      await applyWorktreeEntryChanges({ added: [], updated: refreshed, removedIds: [] }, this.options.now(), this.registryOptions);
    }
    const normalizedRequest: WorktreeCreateRequest =
      typeof request === "string" ? { kind: "new", branch: request, startPoint: "HEAD" } : request;
    const branch = normalizedRequest.kind === "remote" ? normalizedRequest.localBranch : normalizedRequest.branch;
    const existing = refreshed.length > 0 ? await this.list() : registryEntries;
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
    const removedIds: string[] = [];
    for (const entry of Object.values(registry.worktrees)) {
      if (entry.projectId !== projectId || activePaths.has(normalizeWorkspacePath(entry.path))) continue;
      if (await this.options.hasWorktreeSessions?.(entry.id)) continue;
      removedIds.push(entry.id);
    }
    if (removedIds.length > 0) {
      await applyWorktreeEntryChanges({ added: [], removedIds }, this.options.now(), this.registryOptions);
    }
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
    if (state) {
      if (state.lockedReason) throw new Error("Locked worktree must be unlocked before removal");
      const changedFileCount = await worktreeChangedFileCount(worktree.path);
      if (!force && changedFileCount > 0) {
        return {
          removed: false,
          reason: "dirty",
          message: `${worktree.branch}에 커밋되지 않은 변경 ${changedFileCount}개가 있습니다.`,
        };
      }
      // Sessions must stop before git tries to delete the directory: on Windows a live process
      // whose cwd is inside the worktree keeps the directory undeletable.
      await this.options.stopWorktreeSessions(worktreeId);
      await removeGitWorktree(project.rootPath, worktree.path, force);
    }
    // If Git no longer lists the path, a prior attempt already crossed the irreversible boundary
    // (or the worktree disappeared externally). Finish the retryable records/log cleanup directly.
    await this.options.removeWorktreeSessions(worktreeId);
    await removeWorktreeEntry(worktreeId, this.options.now(), this.registryOptions);
    if (this.lastProjects.length > 0) await this.sync(this.lastProjects);
    return { removed: true };
  }
}
