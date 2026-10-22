import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fromLogicalPath, toLogicalPath, type LogicalRoots } from "../../shared/logical-path";
import {
  PROFILE_EXCLUDED_SETTINGS,
  PROFILE_FORMAT,
  PROFILE_VERSION,
  type MultiCliWorkProfileV1,
  type ProfileFolderAction,
  type ProfileFolderProject,
  type ProfileImportPreview,
  type ProfileImportResult,
  type ProfileWorkProject,
} from "../../shared/profile-types";
import type { ProjectRegistryV1, ProjectStatus } from "../../shared/project-types";
import type { ProjectTagsV1 } from "../../shared/project-tags-types";
import { parseSettings, type AppSettings, type AppSettingsPatch } from "../../shared/settings-types";
import type { WorkProject, WorkProjectRegistryV1, WorkProjectRole } from "../../shared/work-project-types";
import { normalizeProjectPath } from "../projects/project-registry";
import type { ProjectMetadataUpdate } from "../projects/project-service";
import type { WorkProjectMetadataUpdate } from "../projects/work-project-service";

export interface ProfileDependencies {
  roots(): LogicalRoots;
  machineName(): string;
  now(): Date;
  platform: NodeJS.Platform;
  settings: {
    get(): AppSettings;
    update(patch: AppSettingsPatch): Promise<unknown>;
  };
  readProjects(): Promise<ProjectRegistryV1>;
  projects: {
    registerManualFolder(rootPath: string, displayName?: string | null): Promise<ProjectRegistryV1>;
    updateProjectMetadata(projectId: string, update: ProjectMetadataUpdate): Promise<ProjectRegistryV1>;
  };
  readWorkProjects(): Promise<WorkProjectRegistryV1>;
  workProjects: {
    createWorkProject(input: { name: string; category?: string }): Promise<WorkProjectRegistryV1>;
    updateWorkProjectMetadata(workProjectId: string, update: WorkProjectMetadataUpdate): Promise<WorkProjectRegistryV1>;
    addMember(workProjectId: string, projectId: string, role: WorkProjectRole): Promise<WorkProjectRegistryV1>;
  };
  readTags(): Promise<ProjectTagsV1>;
  setTags(workProjectId: string, tags: readonly string[]): Promise<unknown>;
  /** 불러오기 직전에 복사해 둘 파일들과 그 복사본을 둘 상위 폴더. */
  backup: { files: string[]; dir: string };
}

const ABSOLUTE_PATTERN = /^([A-Za-z]:[\\/]|[\\/])/;

/** 내보낼 때: 루트 아래면 논리 경로, 아니면 절대경로 그대로. */
function exportPath(abs: string, roots: LogicalRoots): string {
  return toLogicalPath(abs, roots) ?? abs;
}

/** 불러올 때: 논리 경로는 이 PC의 루트로, 절대경로는 그대로. 풀 수 없으면 null. */
export function resolveProfilePath(value: string, roots: LogicalRoots): string | null {
  if (ABSOLUTE_PATTERN.test(value)) return value;
  return fromLogicalPath(value, roots);
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

function exportedSettings(settings: AppSettings): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...settings };
  for (const key of PROFILE_EXCLUDED_SETTINGS) delete copy[key];
  // 일시 중지는 그 순간의 상태지 취향이 아니다 — 다른 PC로 옮기면 엉뚱하게 알림이 꺼진다.
  copy.notifications = { ...settings.notifications, snoozedUntil: null };
  return copy;
}

export async function buildProfile(deps: ProfileDependencies): Promise<MultiCliWorkProfileV1> {
  const roots = deps.roots();
  const [projects, workProjects, tags] = await Promise.all([deps.readProjects(), deps.readWorkProjects(), deps.readTags()]);
  const folderProjects: ProfileFolderProject[] = Object.values(projects.projects)
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
    .map((project) => ({
      path: exportPath(project.rootPath, roots),
      displayName: project.displayName,
      status: project.status,
      memo: project.memo,
      hidden: project.hidden,
    }));
  const exportedWorkProjects: ProfileWorkProject[] = Object.values(workProjects.workProjects)
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
    .map((workProject) => ({
      id: workProject.id,
      name: workProject.name,
      category: workProject.category,
      status: workProject.status,
      memo: workProject.memo,
      notionLinks: workProject.notionLinks,
      localFolders: workProject.localFolders.map((folder) => ({ label: folder.label, path: exportPath(folder.path, roots) })),
      members: workProject.members
        .map((member) => {
          const project = projects.projects[member.projectId];
          return project ? { path: exportPath(project.rootPath, roots), role: member.role } : null;
        })
        .filter((member): member is { path: string; role: WorkProjectRole } => member !== null),
      tags: tags.tags[workProject.id] ?? [],
    }));
  return {
    format: PROFILE_FORMAT,
    version: PROFILE_VERSION,
    exportedAt: deps.now().toISOString(),
    exportedFrom: deps.machineName(),
    settings: exportedSettings(deps.settings.get()),
    folderProjects,
    workProjects: exportedWorkProjects,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const STATUSES: readonly ProjectStatus[] = ["진행중", "보류", "완료", "보관"];
const readStatus = (value: unknown): ProjectStatus | null =>
  STATUSES.includes(value as ProjectStatus) ? (value as ProjectStatus) : null;
const readString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

/**
 * 손으로 고친 파일도 받아 주되, 형식 표식이 틀리면 거부한다 — 엉뚱한 JSON을 설정으로 덮어쓰지 않게.
 * 항목 단위로는 관대하다: 모양이 틀린 항목은 버리고 나머지를 쓴다.
 */
export function parseProfile(raw: unknown): MultiCliWorkProfileV1 {
  if (!isRecord(raw) || raw.format !== PROFILE_FORMAT) throw new Error("multi-cli-work 설정 프로필 파일이 아닙니다");
  if (raw.version !== PROFILE_VERSION) throw new Error(`지원하지 않는 프로필 버전입니다: ${String(raw.version)}`);
  const folderProjects: ProfileFolderProject[] = (Array.isArray(raw.folderProjects) ? raw.folderProjects : [])
    .filter(isRecord)
    .filter((item) => typeof item.path === "string" && item.path.length > 0)
    .map((item) => ({
      path: item.path as string,
      displayName: typeof item.displayName === "string" ? item.displayName : null,
      status: readStatus(item.status),
      memo: readString(item.memo),
      hidden: item.hidden === true,
    }));
  const workProjects: ProfileWorkProject[] = (Array.isArray(raw.workProjects) ? raw.workProjects : [])
    .filter(isRecord)
    .filter((item) => typeof item.name === "string" && item.name.trim().length > 0)
    .map((item) => ({
      id: readString(item.id),
      name: (item.name as string).trim(),
      category: readString(item.category),
      status: readStatus(item.status),
      memo: readString(item.memo),
      notionLinks: (Array.isArray(item.notionLinks) ? item.notionLinks : [])
        .filter(isRecord)
        .filter((link) => typeof link.url === "string" && link.url.length > 0)
        .map((link) => ({ label: readString(link.label, "노션"), url: link.url as string })),
      localFolders: (Array.isArray(item.localFolders) ? item.localFolders : [])
        .filter(isRecord)
        .filter((folder) => typeof folder.path === "string" && folder.path.length > 0)
        .map((folder) => ({ label: readString(folder.label), path: folder.path as string })),
      members: (Array.isArray(item.members) ? item.members : [])
        .filter(isRecord)
        .filter((member) => typeof member.path === "string" && (member.role === "repo" || member.role === "docs"))
        .map((member) => ({ path: member.path as string, role: member.role as WorkProjectRole })),
      tags: (Array.isArray(item.tags) ? item.tags : []).filter((tag): tag is string => typeof tag === "string"),
    }));
  return {
    format: PROFILE_FORMAT,
    version: PROFILE_VERSION,
    exportedAt: readString(raw.exportedAt),
    exportedFrom: readString(raw.exportedFrom),
    settings: isRecord(raw.settings) ? raw.settings : {},
    folderProjects,
    workProjects,
  };
}

/** 불러온 설정 — PC 전용 키는 이 PC의 값으로 지키고, 나머지는 파서가 정리한다. */
function importedSettings(profile: MultiCliWorkProfileV1, current: AppSettings): AppSettings {
  const merged: Record<string, unknown> = { ...current, ...profile.settings };
  for (const key of PROFILE_EXCLUDED_SETTINGS) merged[key] = current[key];
  return parseSettings(merged);
}

function settingsPatch(next: AppSettings): AppSettingsPatch {
  const { remote: _remote, pcRoots: _pcRoots, driveKind: _driveKind, ...rest } = next;
  return rest;
}

function matchWorkProject(registry: WorkProjectRegistryV1, entry: ProfileWorkProject): WorkProject | undefined {
  const byId = entry.id ? registry.workProjects[entry.id] : undefined;
  if (byId) return byId;
  const key = entry.name.normalize("NFC");
  return Object.values(registry.workProjects).find((workProject) => workProject.name.normalize("NFC") === key);
}

interface FolderPlanEntry {
  path: string;
  resolvedPath: string | null;
  action: ProfileFolderAction;
}

async function planFolders(
  profile: MultiCliWorkProfileV1,
  projects: ProjectRegistryV1,
  roots: LogicalRoots,
  platform: NodeJS.Platform,
): Promise<FolderPlanEntry[]> {
  const registered = new Set(Object.values(projects.projects).map((project) => normalizeProjectPath(project.rootPath, platform)));
  const wanted = new Map<string, true>();
  for (const folder of profile.folderProjects) wanted.set(folder.path, true);
  for (const workProject of profile.workProjects) for (const member of workProject.members) wanted.set(member.path, true);
  const plan: FolderPlanEntry[] = [];
  for (const folderPath of wanted.keys()) {
    const resolvedPath = resolveProfilePath(folderPath, roots);
    if (resolvedPath === null || !(await isDirectory(resolvedPath))) {
      plan.push({ path: folderPath, resolvedPath, action: "missing" });
      continue;
    }
    plan.push({
      path: folderPath,
      resolvedPath,
      action: registered.has(normalizeProjectPath(resolvedPath, platform)) ? "exists" : "add",
    });
  }
  return plan;
}

export async function previewProfileImport(
  profilePath: string,
  profile: MultiCliWorkProfileV1,
  deps: ProfileDependencies,
): Promise<ProfileImportPreview> {
  const current = deps.settings.get();
  const next = importedSettings(profile, current);
  const settingsChanged = (Object.keys(next) as Array<keyof AppSettings>).filter(
    (key) => JSON.stringify(next[key]) !== JSON.stringify(current[key]),
  );
  const [projects, workProjects] = await Promise.all([deps.readProjects(), deps.readWorkProjects()]);
  return {
    path: profilePath,
    exportedAt: profile.exportedAt,
    exportedFrom: profile.exportedFrom,
    settingsChanged,
    workProjects: profile.workProjects.map((entry) => ({
      name: entry.name,
      action: matchWorkProject(workProjects, entry) ? "update" : "add",
    })),
    folders: await planFolders(profile, projects, deps.roots(), deps.platform),
  };
}

async function backupFiles(deps: ProfileDependencies): Promise<string> {
  const stamp = deps.now().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(deps.backup.dir, stamp);
  await mkdir(dir, { recursive: true });
  for (const file of deps.backup.files) {
    await copyFile(file, path.join(dir, path.basename(file))).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return dir;
}

/**
 * 병합만 한다 — 이 PC에만 있는 업무 프로젝트·폴더는 지우지 않는다. 같은 업무 프로젝트(id, 없으면
 * 이름)는 프로필 값으로 갱신하고, 이 PC에 없는 폴더는 등록하지 않고 알린다.
 */
export async function applyProfileImport(
  profile: MultiCliWorkProfileV1,
  deps: ProfileDependencies,
): Promise<ProfileImportResult> {
  const backupDir = await backupFiles(deps);
  const roots = deps.roots();

  await deps.settings.update(settingsPatch(importedSettings(profile, deps.settings.get())));

  // 1) 폴더 — 이 PC에 실제로 있는 것만 등록하고, 경로 → 폴더 id 지도를 만든다.
  const plan = await planFolders(profile, await deps.readProjects(), roots, deps.platform);
  let addedFolders = 0;
  for (const entry of plan) {
    if (entry.action !== "add" || entry.resolvedPath === null) continue;
    await deps.projects.registerManualFolder(entry.resolvedPath, path.basename(entry.resolvedPath));
    addedFolders += 1;
  }
  const projects = await deps.readProjects();
  const idByPath = new Map(
    Object.values(projects.projects).map((project) => [normalizeProjectPath(project.rootPath, deps.platform), project.id]),
  );
  const projectIdFor = (profilePath: string): string | null => {
    const resolved = resolveProfilePath(profilePath, roots);
    return resolved === null ? null : idByPath.get(normalizeProjectPath(resolved, deps.platform)) ?? null;
  };
  for (const folder of profile.folderProjects) {
    const projectId = projectIdFor(folder.path);
    if (projectId === null) continue;
    await deps.projects.updateProjectMetadata(projectId, {
      displayName: folder.displayName,
      status: folder.status,
      memo: folder.memo,
      hidden: folder.hidden,
    });
  }

  // 2) 업무 프로젝트 — 만들거나 갱신하고, 풀리는 멤버를 붙인다.
  let addedWorkProjects = 0;
  let updatedWorkProjects = 0;
  for (const entry of profile.workProjects) {
    let registry = await deps.readWorkProjects();
    let target = matchWorkProject(registry, entry);
    if (target) {
      updatedWorkProjects += 1;
    } else {
      const before = new Set(Object.keys(registry.workProjects));
      registry = await deps.workProjects.createWorkProject({
        name: entry.name,
        ...(entry.category ? { category: entry.category } : {}),
      });
      target = Object.values(registry.workProjects).find((workProject) => !before.has(workProject.id));
      if (!target) continue;
      addedWorkProjects += 1;
    }
    // 참고 폴더는 이 PC에서 풀리는 것만 프로필 값으로, 풀리지 않는 것은 이 PC의 값을 지킨다.
    const localFolders = entry.localFolders
      .map((folder) => {
        const resolved = resolveProfilePath(folder.path, roots);
        return resolved === null ? null : { label: folder.label, path: resolved };
      })
      .filter((folder): folder is { label: string; path: string } => folder !== null);
    await deps.workProjects.updateWorkProjectMetadata(target.id, {
      name: entry.name,
      ...(entry.category ? { category: entry.category } : {}),
      status: entry.status,
      memo: entry.memo,
      notionLinks: entry.notionLinks,
      localFolders: localFolders.length > 0 || entry.localFolders.length === 0 ? localFolders : target.localFolders,
    });
    const memberIds = new Set(target.members.map((member) => member.projectId));
    for (const member of entry.members) {
      const projectId = projectIdFor(member.path);
      if (projectId === null || memberIds.has(projectId)) continue;
      await deps.workProjects.addMember(target.id, projectId, member.role);
    }
    if (entry.tags.length > 0) {
      const currentTags = (await deps.readTags()).tags[target.id] ?? [];
      await deps.setTags(target.id, [...new Set([...currentTags, ...entry.tags])]);
    }
  }

  return {
    addedWorkProjects,
    updatedWorkProjects,
    addedFolders,
    missingFolders: plan.filter((entry) => entry.action === "missing").map((entry) => entry.path),
    backupDir,
  };
}
