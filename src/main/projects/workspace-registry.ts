import os from "node:os";
import path from "node:path";
import type {
  WorkspaceRegistryV1,
  WorkspaceRoot,
  WorkspaceShellLink,
} from "../../shared/workspace-types";
import { pathStyleFor, workspacePathKey } from "../../shared/workspace-path";
import {
  type JsonStoreSpec,
  readJsonStore,
  restoreJsonStoreBackup,
  updateJsonStore,
} from "../storage/json-store";

/**
 * 워크스페이스 루트 설정. `work-project-registry.ts`와 같은 프로토콜을 쓴다 — 잠금·원자적 쓰기·
 * `.bak`은 `json-store`가, exact-keys 파싱과 canonical ISO는 여기가 맡는다
 * (docs/superpowers/specs/registry-contract.md §3~§6).
 */
export const WORKSPACE_REGISTRY_PATH = path.join(os.homedir(), ".multi-cli-work", "workspace.json");

const REGISTRY_KEYS = ["schemaVersion", "updatedAt", "roots", "shellLinks"] as const;
const ROOT_KEYS = ["path", "label", "devPath", "dataPath"] as const;
const SHELL_LINK_KEYS = ["workProjectId", "root", "channel", "shell"] as const;

export class WorkspaceRegistryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkspaceRegistryError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new WorkspaceRegistryError(`${label} contains unknown fields: ${unknown.join(", ")}`);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new WorkspaceRegistryError(`${label} must be a non-empty string`);
  }
  return value;
}

function plainString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new WorkspaceRegistryError(`${label} must be a string`);
  return value;
}

/** 계약 §3: 읽을 때는 Date.parse 가능한 값을 canonical로 받아들이고, 쓸 때는 canonical만 남긴다. */
function isoString(value: unknown, label: string): string {
  const raw = requiredString(value, label);
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) throw new WorkspaceRegistryError(`${label} must be an ISO timestamp`);
  return new Date(parsed).toISOString();
}

/**
 * dev/data 루트의 관례값 — work 루트의 형제 폴더(루트 CLAUDE.md §1). 손으로 적은 파일이 이 키를
 * 빼먹었을 때만 쓰이고, 앱이 등록할 때는 실제 폴더를 찾아 적으므로 여기까지 오지 않는다.
 */
export function siblingRoot(workPath: string, name: string, platform: NodeJS.Platform = process.platform): string {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  return pathApi.join(pathApi.dirname(pathApi.resolve(workPath)), name);
}

function parseRoots(value: unknown): WorkspaceRoot[] {
  if (!Array.isArray(value)) throw new WorkspaceRegistryError("Workspace registry roots must be an array");
  const roots = value.map((root, index) => {
    if (!isRecord(root)) throw new WorkspaceRegistryError(`Workspace root [${index}] must be an object`);
    assertExactKeys(root, ROOT_KEYS, `Workspace root [${index}]`);
    const workPath = requiredString(root.path, `Workspace root [${index}].path`);
    return {
      path: workPath,
      label: plainString(root.label, `Workspace root [${index}].label`),
      devPath:
        root.devPath === undefined
          ? siblingRoot(workPath, "dev")
          : requiredString(root.devPath, `Workspace root [${index}].devPath`),
      dataPath:
        root.dataPath === undefined
          ? siblingRoot(workPath, "data")
          : requiredString(root.dataPath, `Workspace root [${index}].dataPath`),
    };
  });
  // 계약 §7의 정규화 경로로 중복을 본다 — 같은 폴더가 두 줄이면 역인덱스가 두 번 스캔된다.
  const keys = new Set(roots.map((root) => workspacePathKey(root.path)));
  if (keys.size !== roots.length) {
    throw new WorkspaceRegistryError("Workspace registry contains duplicate roots");
  }
  return roots;
}

function parseShellLinks(value: unknown): WorkspaceShellLink[] {
  // shellLinks 없이 손으로 만든 파일은 "연결 없음"으로 읽는다. 쓰기는 항상 키를 남긴다.
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new WorkspaceRegistryError("Workspace registry shellLinks must be an array");
  const links = value.map((link, index) => {
    if (!isRecord(link)) throw new WorkspaceRegistryError(`Workspace shell link [${index}] must be an object`);
    assertExactKeys(link, SHELL_LINK_KEYS, `Workspace shell link [${index}]`);
    return {
      workProjectId: requiredString(link.workProjectId, `Workspace shell link [${index}].workProjectId`),
      root: requiredString(link.root, `Workspace shell link [${index}].root`),
      channel: requiredString(link.channel, `Workspace shell link [${index}].channel`),
      shell: requiredString(link.shell, `Workspace shell link [${index}].shell`),
    };
  });
  const byWorkProject = new Set(links.map((link) => link.workProjectId));
  if (byWorkProject.size !== links.length) {
    throw new WorkspaceRegistryError("Workspace registry links a work project more than once");
  }
  // 한 셸이 업무 프로젝트 둘을 가리키면 사이드바 묶음이 애매해진다.
  const byShell = new Set(links.map((link) => `${workspacePathKey(link.root)}|${link.channel}/${link.shell}`));
  if (byShell.size !== links.length) {
    throw new WorkspaceRegistryError("Workspace registry links a shell more than once");
  }
  return links;
}

export function parseWorkspaceRegistry(value: unknown): WorkspaceRegistryV1 {
  if (!isRecord(value)) throw new WorkspaceRegistryError("Workspace registry must be an object");
  assertExactKeys(value, REGISTRY_KEYS, "Workspace registry");
  if (value.schemaVersion !== 1) {
    throw new WorkspaceRegistryError(`Unsupported workspace registry schema: ${String(value.schemaVersion)}`);
  }
  return {
    schemaVersion: 1,
    updatedAt: isoString(value.updatedAt, "Workspace registry updatedAt"),
    roots: parseRoots(value.roots),
    shellLinks: parseShellLinks(value.shellLinks),
  };
}

export function emptyWorkspaceRegistry(now = new Date().toISOString()): WorkspaceRegistryV1 {
  return { schemaVersion: 1, updatedAt: now, roots: [], shellLinks: [] };
}

const STORE: JsonStoreSpec<WorkspaceRegistryV1> = {
  label: "workspace registry",
  parse: parseWorkspaceRegistry,
  empty: () => emptyWorkspaceRegistry(),
  error: (message, options) => new WorkspaceRegistryError(message, options),
  isContentError: (error) => error instanceof WorkspaceRegistryError,
};

export interface WorkspaceRegistryOptions {
  registryPath?: string;
  lockRetryMs?: number;
  now?: () => string;
  platform?: NodeJS.Platform;
}

function registryPathOf(options: WorkspaceRegistryOptions): string {
  return options.registryPath ?? WORKSPACE_REGISTRY_PATH;
}

function nowOf(options: WorkspaceRegistryOptions): string {
  return (options.now ?? (() => new Date().toISOString()))();
}

export async function readWorkspaceRegistry(
  options: WorkspaceRegistryOptions = {},
): Promise<WorkspaceRegistryV1> {
  return (await readJsonStore(STORE, registryPathOf(options))).value;
}

export async function updateWorkspaceRegistry(
  update: (registry: WorkspaceRegistryV1) => WorkspaceRegistryV1 | Promise<WorkspaceRegistryV1>,
  options: WorkspaceRegistryOptions = {},
): Promise<WorkspaceRegistryV1> {
  return updateJsonStore(STORE, registryPathOf(options), update, {
    ...(options.lockRetryMs !== undefined ? { lockRetryMs: options.lockRetryMs } : {}),
  });
}

export async function restoreWorkspaceRegistryFromBackup(
  options: WorkspaceRegistryOptions = {},
): Promise<WorkspaceRegistryV1> {
  return restoreJsonStoreBackup(STORE, registryPathOf(options), {
    ...(options.lockRetryMs !== undefined ? { lockRetryMs: options.lockRetryMs } : {}),
  });
}

/**
 * 루트를 등록한다. 이미 있는 폴더를 다시 고르면 라벨만 갱신하고 줄을 늘리지 않는다 —
 * `upsertManualProject`가 폴더에 대해 하는 것과 같은 판정(정규화 경로 비교).
 */
export async function addWorkspaceRoot(
  rootPath: string,
  label: string | null,
  siblings: { devPath?: string; dataPath?: string } = {},
  options: WorkspaceRegistryOptions = {},
): Promise<WorkspaceRegistryV1> {
  if (typeof rootPath !== "string" || rootPath.trim().length === 0) {
    throw new WorkspaceRegistryError("Workspace root path must be a non-empty string");
  }
  const platform = options.platform ?? process.platform;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const resolved = pathApi.resolve(rootPath);
  const style = pathStyleFor(platform);
  const name = (label ?? "").trim() || pathApi.basename(resolved) || resolved;
  const devPath = siblings.devPath ?? siblingRoot(resolved, "dev", platform);
  const dataPath = siblings.dataPath ?? siblingRoot(resolved, "data", platform);
  const now = nowOf(options);
  return updateWorkspaceRegistry((registry) => {
    const key = workspacePathKey(resolved, style);
    const existing = registry.roots.findIndex((root) => workspacePathKey(root.path, style) === key);
    // 다시 고른 폴더는 줄을 늘리지 않고 라벨과 dev/data 위치만 갱신한다 — 그 사이 배치가 옮겨졌을 수 있다.
    const roots =
      existing >= 0
        ? registry.roots.map((root, index) =>
            index === existing ? { ...root, label: name, devPath, dataPath } : root,
          )
        : [...registry.roots, { path: resolved, label: name, devPath, dataPath }];
    return { ...registry, updatedAt: now, roots };
  }, options);
}

/**
 * 루트를 목록에서 뺀다. 디스크의 폴더도, 그 루트에서 만들어진 업무 프로젝트도 지우지 않는다 —
 * `projects:remove`가 폴더 목록에서만 빼는 것과 같은 약속이다. 다만 그 루트의 셸 연결은 함께
 * 지운다: 남겨 두면 다시 등록했을 때 사라진 업무 프로젝트를 가리키는 연결이 살아난다.
 */
export async function removeWorkspaceRoot(
  rootPath: string,
  options: WorkspaceRegistryOptions = {},
): Promise<WorkspaceRegistryV1> {
  const style = pathStyleFor(options.platform ?? process.platform);
  const key = workspacePathKey(requiredString(rootPath, "Workspace root path"), style);
  const now = nowOf(options);
  return updateWorkspaceRegistry((registry) => {
    if (!registry.roots.some((root) => workspacePathKey(root.path, style) === key)) {
      throw new WorkspaceRegistryError(`Workspace root ${rootPath} is not registered`);
    }
    return {
      ...registry,
      updatedAt: now,
      roots: registry.roots.filter((root) => workspacePathKey(root.path, style) !== key),
      shellLinks: registry.shellLinks.filter((link) => workspacePathKey(link.root, style) !== key),
    };
  }, options);
}

/** 자동 생성 업무 프로젝트 연결을 통째로 갈아 끼운다(`syncFromWorkspace`가 한 번에 쓴다). */
export async function setWorkspaceShellLinks(
  links: readonly WorkspaceShellLink[],
  options: WorkspaceRegistryOptions = {},
): Promise<WorkspaceRegistryV1> {
  const now = nowOf(options);
  return updateWorkspaceRegistry(
    (registry) => ({ ...registry, updatedAt: now, shellLinks: [...links] }),
    options,
  );
}
