import { randomUUID } from "node:crypto";
import path from "node:path";
import type { ProjectStatus, SharedProject } from "../../shared/project-types";
import type {
  WorkProject,
  WorkProjectLocalFolder,
  WorkProjectMember,
  WorkProjectNotionLink,
  WorkProjectRegistryV1,
  WorkProjectRole,
} from "../../shared/work-project-types";
import type { WorkspaceShellLink, WorkspaceSnapshot } from "../../shared/workspace-types";
import {
  pathStyleFor,
  relativeSegments,
  resolveShellRefForPath,
  workspacePathKey,
  type ChannelLetter,
} from "../../shared/workspace-path";
import { updateWorkProjectRegistry } from "./work-project-registry";
import { setWorkspaceShellLinks, type WorkspaceRegistryOptions } from "./workspace-registry";

const METADATA_KEYS = ["name", "category", "status", "memo", "notionLinks", "localFolders", "order"] as const;

/**
 * 채널 글자 → 업무 프로젝트 구분. 루트 CLAUDE.md §1의 채널 어휘를 앱의 어휘로 옮긴 것뿐이며,
 * 만들 때 한 번만 쓴다 — 사용자가 나중에 구분을 바꾸면 그 선택이 이긴다.
 */
const CHANNEL_CATEGORY: Record<ChannelLetter, string> = {
  G: "정부지원과제",
  O: "외주개발",
  R: "연구",
  Z: "기타",
  P: "기타",
};

type RegistryUpdater = typeof updateWorkProjectRegistry;

export interface WorkProjectMetadataUpdate {
  name?: string;
  category?: string;
  status?: ProjectStatus | null;
  memo?: string;
  notionLinks?: WorkProjectNotionLink[];
  localFolders?: WorkProjectLocalFolder[];
  order?: number | null;
}

export interface WorkProjectServiceOptions {
  registryPath?: string;
  now?: () => string;
  idFactory?: () => string;
  registryUpdater?: RegistryUpdater;
  /** ws-root 연동에만 쓴다 — 자동 생성분의 출처(`shellLinks`)가 사는 파일. */
  workspaceRegistryPath?: string;
  /** 업무 프로젝트 자유 태그 레지스트리 경로. 이 서비스는 아직 읽지 않는다(Task 4에서 소비). */
  projectTagsPath?: string;
  platform?: NodeJS.Platform;
}

export interface WorkspaceSyncResult {
  workProjects: WorkProjectRegistryV1;
  /** 이번 동기화로 새로 만들어진 업무 프로젝트 수. */
  created: number;
  /** 이름이 같은 수동 항목이 있어 건너뛴 셸의 ref. */
  skipped: string[];
}

export class WorkProjectServiceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkProjectServiceError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateMetadataUpdate(update: unknown): asserts update is WorkProjectMetadataUpdate {
  if (!isRecord(update)) throw new WorkProjectServiceError("Work project update must be an object");
  const unknownKeys = Object.keys(update).filter(
    (key) => !METADATA_KEYS.includes(key as (typeof METADATA_KEYS)[number]),
  );
  if (unknownKeys.length > 0) {
    throw new WorkProjectServiceError(`Work project update contains unknown fields: ${unknownKeys.join(", ")}`);
  }
}

/**
 * The UI hands over its rows as-is, drafts included: trim each row, drop the ones without a URL,
 * and give unlabeled rows the plain "노션" label the registry requires.
 */
function normalizeNotionLinks(links: WorkProjectNotionLink[] | undefined): WorkProjectNotionLink[] | undefined {
  if (links === undefined) return undefined;
  if (!Array.isArray(links)) throw new WorkProjectServiceError("Work project notionLinks must be an array");
  return links
    .map((link) => ({ label: String(link?.label ?? "").trim(), url: String(link?.url ?? "").trim() }))
    .filter((link) => link.url.length > 0)
    .map((link) => ({ label: link.label.length === 0 ? "노션" : link.label, url: link.url }));
}

/**
 * Same draft-row handling as the Notion links, with the folder's own name as the default label —
 * more useful than a fixed word, and the only thing the user would type there anyway. The path is
 * stored as given: it is a path on this machine, and whether it exists is the file explorer's
 * answer to give, not the registry's.
 */
function normalizeLocalFolders(folders: WorkProjectLocalFolder[] | undefined): WorkProjectLocalFolder[] | undefined {
  if (folders === undefined) return undefined;
  if (!Array.isArray(folders)) throw new WorkProjectServiceError("Work project localFolders must be an array");
  return folders
    .map((folder) => ({ label: String(folder?.label ?? "").trim(), path: String(folder?.path ?? "").trim() }))
    .filter((folder) => folder.path.length > 0)
    .map((folder) => ({
      label: folder.label.length === 0 ? path.basename(folder.path) || folder.path : folder.label,
      path: folder.path,
    }));
}

/** 순서까지 같아야 같은 것으로 본다 — 순서가 흔들리면 사이드바 줄이 이유 없이 뛴다. */
function sameMembers(left: readonly WorkProjectMember[], right: readonly WorkProjectMember[]): boolean {
  return (
    left.length === right.length &&
    left.every((member, index) => member.projectId === right[index].projectId && member.role === right[index].role)
  );
}

export class WorkProjectService {
  private readonly options: WorkProjectServiceOptions;

  constructor(options: WorkProjectServiceOptions = {}) {
    this.options = options;
  }

  async createWorkProject(input: { name: string; category?: string }): Promise<WorkProjectRegistryV1> {
    if (typeof input?.name !== "string" || input.name.trim().length === 0) {
      throw new WorkProjectServiceError("Work project name must be a non-empty string");
    }
    const category = input.category === undefined ? "기타" : input.category;
    if (typeof category !== "string" || category.trim().length === 0) {
      throw new WorkProjectServiceError("Work project category must be a non-empty string");
    }
    const now = this.now();
    const workProject: WorkProject = {
      id: (this.options.idFactory ?? randomUUID)(),
      name: input.name.trim(),
      category: category.trim(),
      status: null,
      memo: "",
      notionLinks: [],
      localFolders: [],
      members: [],
      order: null,
      createdAt: now,
      updatedAt: now,
    };
    return this.updateRegistry((registry) => ({
      ...registry,
      updatedAt: now,
      workProjects: { ...registry.workProjects, [workProject.id]: workProject },
    }));
  }

  async updateWorkProjectMetadata(
    workProjectId: string,
    update: WorkProjectMetadataUpdate,
  ): Promise<WorkProjectRegistryV1> {
    validateMetadataUpdate(update);
    const now = this.now();
    return this.updateRegistry((registry) => {
      const workProject = this.require(registry, workProjectId);
      const next = { ...workProject, updatedAt: now };
      const value = (key: (typeof METADATA_KEYS)[number]): unknown => {
        if (key === "notionLinks") return normalizeNotionLinks(update.notionLinks);
        if (key === "localFolders") return normalizeLocalFolders(update.localFolders);
        return update[key];
      };
      for (const key of METADATA_KEYS) {
        if (Object.prototype.hasOwnProperty.call(update, key) && update[key] !== undefined) {
          Object.assign(next, { [key]: value(key) });
        }
      }
      return {
        ...registry,
        updatedAt: now,
        workProjects: { ...registry.workProjects, [workProjectId]: next },
      };
    });
  }

  async removeWorkProject(workProjectId: string): Promise<WorkProjectRegistryV1> {
    const now = this.now();
    return this.updateRegistry((registry) => {
      this.require(registry, workProjectId);
      const workProjects = { ...registry.workProjects };
      delete workProjects[workProjectId];
      return { ...registry, updatedAt: now, workProjects };
    });
  }

  /**
   * Adds a folder to a work project. A folder belongs to at most one work project, so adding it
   * while it is a member elsewhere moves it — the sidebar drag/context-menu semantics — rather than
   * failing and making the caller orchestrate a remove first.
   */
  async addMember(workProjectId: string, projectId: string, role: WorkProjectRole): Promise<WorkProjectRegistryV1> {
    if (typeof projectId !== "string" || projectId.length === 0) {
      throw new WorkProjectServiceError("Member projectId must be a non-empty string");
    }
    if (role !== "repo" && role !== "docs") {
      throw new WorkProjectServiceError("Member role must be 'repo' or 'docs'");
    }
    const now = this.now();
    return this.updateRegistry((registry) => {
      this.require(registry, workProjectId);
      const workProjects = Object.fromEntries(
        Object.entries(registry.workProjects).map(([id, workProject]) => {
          const withoutMember = workProject.members.filter((member) => member.projectId !== projectId);
          if (id === workProjectId) {
            return [id, { ...workProject, members: [...withoutMember, { projectId, role }], updatedAt: now }];
          }
          if (withoutMember.length !== workProject.members.length) {
            return [id, { ...workProject, members: withoutMember, updatedAt: now }];
          }
          return [id, workProject];
        }),
      );
      return { ...registry, updatedAt: now, workProjects };
    });
  }

  async removeMember(workProjectId: string, projectId: string): Promise<WorkProjectRegistryV1> {
    const now = this.now();
    return this.updateRegistry((registry) => {
      const workProject = this.require(registry, workProjectId);
      if (!workProject.members.some((member) => member.projectId === projectId)) {
        throw new WorkProjectServiceError(`Project ${projectId} is not a member of work project ${workProjectId}`);
      }
      return {
        ...registry,
        updatedAt: now,
        workProjects: {
          ...registry.workProjects,
          [workProjectId]: {
            ...workProject,
            members: workProject.members.filter((member) => member.projectId !== projectId),
            updatedAt: now,
          },
        },
      };
    });
  }

  /**
   * Drops every membership referencing a folder project that no longer exists — called after a
   * folder is removed from the project registry so work projects do not accumulate dangling members.
   */
  async removeProjectReferences(projectId: string): Promise<WorkProjectRegistryV1> {
    const now = this.now();
    return this.updateRegistry((registry) => {
      let changed = false;
      const workProjects = Object.fromEntries(
        Object.entries(registry.workProjects).map(([id, workProject]) => {
          const members = workProject.members.filter((member) => member.projectId !== projectId);
          if (members.length === workProject.members.length) return [id, workProject];
          changed = true;
          return [id, { ...workProject, members, updatedAt: now }];
        }),
      );
      if (!changed) return registry;
      return { ...registry, updatedAt: now, workProjects };
    });
  }

  /** Mirrors `ProjectService.reorderProjects`: one transaction, unlisted ids keep relative order. */
  async reorderWorkProjects(orderedIds: readonly string[]): Promise<WorkProjectRegistryV1> {
    if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string" || id.length === 0)) {
      throw new WorkProjectServiceError("Work project order must be a list of work project ids");
    }
    if (new Set(orderedIds).size !== orderedIds.length) {
      throw new WorkProjectServiceError("Work project order contains duplicate ids");
    }
    const now = this.now();
    return this.updateRegistry((registry) => {
      const unknown = orderedIds.filter((id) => !registry.workProjects[id]);
      if (unknown.length > 0) {
        throw new WorkProjectServiceError(`Work project order references unknown work projects: ${unknown.join(", ")}`);
      }
      const listed = new Set(orderedIds);
      const trailing = Object.values(registry.workProjects)
        .filter((workProject) => !listed.has(workProject.id))
        .sort(
          (left, right) =>
            (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER) ||
            left.id.localeCompare(right.id),
        )
        .map((workProject) => workProject.id);
      const workProjects = { ...registry.workProjects };
      [...orderedIds, ...trailing].forEach((id, index) => {
        const workProject = workProjects[id];
        if (workProject.order === index) return;
        workProjects[id] = { ...workProject, order: index, updatedAt: now };
      });
      return { ...registry, updatedAt: now, workProjects };
    });
  }

  /**
   * ws-root 워크스페이스의 셸을 업무 프로젝트로 옮겨 적는다. 루트 CLAUDE.md §3이 셸 프론트매터의
   * `repos:`를 레포→셸 역인덱스의 SSOT로 정했으므로, 여기서는 그 사실을 앱의 어휘로 반복할 뿐이다.
   *
   * 지키는 선:
   *  - **사용자가 손으로 만든 항목은 절대 건드리지 않는다.** 이름이 같은 항목이 이미 있으면 그
   *    셸은 건너뛴다(덮어쓰지도, 같은 이름을 하나 더 만들지도 않는다).
   *  - 자동 생성분도 **`members`만** 갱신한다. 구분·상태·메모·노션 링크·순서는 만들 때 한 번
   *    정해지고 그 뒤로는 사용자의 것이다.
   *  - 수동 업무 프로젝트에 이미 속한 폴더는 가져오지 않는다 — 사용자가 옮겨 둔 자리가 이긴다.
   *  - 출처 표식은 `workspace.json`의 `shellLinks`에 둔다. `work-projects.json` 스키마는
   *    그대로다(레지스트리 계약 §8).
   */
  async syncFromWorkspace(
    snapshot: WorkspaceSnapshot,
    projects: readonly SharedProject[],
  ): Promise<WorkspaceSyncResult> {
    const style = pathStyleFor(this.options.platform ?? process.platform);
    const now = this.now();
    const shellByRef = new Map(snapshot.shells.map((shell) => [shell.ref, shell]));
    const lookup = { roots: snapshot.registry.roots, repoOwners: snapshot.repoOwners };

    // 열어 둔 폴더를 셸별로 모은다. 셸 폴더(또는 그 하위)는 문서, 나머지는 레포로 읽는다.
    const membersByRef = new Map<string, WorkProjectMember[]>();
    for (const project of projects) {
      const ref = resolveShellRefForPath(project.rootPath, lookup, style);
      if (!ref) continue;
      const shell = shellByRef.get(ref);
      if (!shell) continue;
      const inShellFolder = relativeSegments(shell.path, project.rootPath, style) !== null;
      const role: WorkProjectRole = inShellFolder ? "docs" : "repo";
      membersByRef.set(ref, [...(membersByRef.get(ref) ?? []), { projectId: project.id, role }]);
    }

    const linkKey = (root: string, ref: string) => `${workspacePathKey(root, style)}|${ref}`;
    const linksByKey = new Map(
      snapshot.registry.shellLinks.map((link) => [linkKey(link.root, `${link.channel}/${link.shell}`), link]),
    );
    let created = 0;
    const skipped: string[] = [];
    let nextLinks: WorkspaceShellLink[] = [];

    const workProjects = await this.updateRegistry((registry) => {
      created = 0;
      skipped.length = 0;
      const next = { ...registry.workProjects };
      // 대응하는 업무 프로젝트가 사라진 연결은 흔적만 남은 것이므로 버린다.
      const surviving = snapshot.registry.shellLinks.filter((link) => next[link.workProjectId]);
      const linkedIds = new Set(surviving.map((link) => link.workProjectId));
      // 수동 항목이 데리고 있는 폴더는 건드리지 않는다.
      const manualOwned = new Set(
        Object.values(next)
          .filter((workProject) => !linkedIds.has(workProject.id))
          .flatMap((workProject) => workProject.members.map((member) => member.projectId)),
      );
      nextLinks = [...surviving];
      const claimed = new Map<string, string>();

      for (const shell of snapshot.shells) {
        const name = shell.ref;
        const link = linksByKey.get(linkKey(shell.root, shell.ref));
        let target = link ? next[link.workProjectId] : undefined;
        if (!target) {
          if (Object.values(next).some((workProject) => workProject.name === name)) {
            skipped.push(shell.ref);
            continue;
          }
          const id = (this.options.idFactory ?? randomUUID)();
          target = {
            id,
            name,
            category: CHANNEL_CATEGORY[shell.channelLetter as ChannelLetter] ?? "기타",
            status: null,
            memo: "",
            notionLinks: [],
            localFolders: [],
            members: [],
            order: null,
            createdAt: now,
            updatedAt: now,
          };
          next[id] = target;
          nextLinks.push({
            workProjectId: id,
            root: shell.root,
            channel: shell.channel,
            shell: shell.shell,
          });
          created += 1;
        }
        const members = (membersByRef.get(shell.ref) ?? []).filter(
          (member) => !manualOwned.has(member.projectId),
        );
        for (const member of members) claimed.set(member.projectId, target.id);
        if (!sameMembers(target.members, members)) {
          next[target.id] = { ...target, members, updatedAt: now };
        }
      }

      // 한 폴더는 한 업무 프로젝트에만 속한다 — 보이지 않는 셸에 묶여 있던 낡은 소속을 떼어 낸다.
      for (const workProject of Object.values(next)) {
        const kept = workProject.members.filter(
          (member) => !claimed.has(member.projectId) || claimed.get(member.projectId) === workProject.id,
        );
        if (kept.length !== workProject.members.length) {
          next[workProject.id] = { ...workProject, members: kept, updatedAt: now };
        }
      }
      return { ...registry, updatedAt: now, workProjects: next };
    });

    // 업무 프로젝트를 먼저 쓰고 연결을 쓴다 — 연결이 가리키는 대상이 먼저 있어야 한다.
    if (JSON.stringify(nextLinks) !== JSON.stringify(snapshot.registry.shellLinks)) {
      const workspaceOptions: WorkspaceRegistryOptions = {
        ...(this.options.workspaceRegistryPath ? { registryPath: this.options.workspaceRegistryPath } : {}),
        ...(this.options.platform ? { platform: this.options.platform } : {}),
        now: () => now,
      };
      await setWorkspaceShellLinks(nextLinks, workspaceOptions);
    }
    return { workProjects, created, skipped };
  }

  /** `null` clears the setting; a path must be absolute — the folder dialog is the usual source. */
  async setTeamsSyncRoot(rootPath: string | null): Promise<WorkProjectRegistryV1> {
    if (rootPath !== null && (typeof rootPath !== "string" || rootPath.trim().length === 0)) {
      throw new WorkProjectServiceError("Teams sync root must be a non-empty string or null");
    }
    const now = this.now();
    return this.updateRegistry((registry) => ({ ...registry, updatedAt: now, teamsSyncRoot: rootPath }));
  }

  private now(): string {
    return (this.options.now ?? (() => new Date().toISOString()))();
  }

  private require(registry: WorkProjectRegistryV1, workProjectId: string): WorkProject {
    const workProject = registry.workProjects[workProjectId];
    if (!workProject) throw new WorkProjectServiceError(`Work project ${workProjectId} was not found`);
    return workProject;
  }

  private updateRegistry(update: Parameters<RegistryUpdater>[0]): Promise<WorkProjectRegistryV1> {
    const registryUpdater = this.options.registryUpdater ?? updateWorkProjectRegistry;
    return registryUpdater(update, { registryPath: this.options.registryPath });
  }
}
