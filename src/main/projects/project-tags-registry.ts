import os from "node:os";
import path from "node:path";
import { normalizeTags, type ProjectTagsV1 } from "../../shared/project-tags-types";
import {
  type JsonStoreSpec,
  readJsonStore,
  restoreJsonStoreBackup,
  updateJsonStore,
} from "../storage/json-store";

/**
 * 업무 프로젝트 자유 태그. `work-projects.json`이 아니라 별도 파일에 산다 —
 * 이유는 `src/shared/project-tags-types.ts` 상단 주석 참고
 * (docs/superpowers/specs/registry-contract.md §8). `workspace-registry.ts`와 같은
 * 프로토콜을 쓴다 — 잠금·원자적 쓰기·`.bak`은 `json-store`가, exact-keys 파싱과 canonical ISO는
 * 여기가 맡는다 (docs/superpowers/specs/registry-contract.md §3~§6).
 */
export const PROJECT_TAGS_PATH = path.join(os.homedir(), ".multi-cli-work", "project-tags.json");

const REGISTRY_KEYS = ["schemaVersion", "updatedAt", "tags"] as const;

export class ProjectTagsRegistryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProjectTagsRegistryError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ProjectTagsRegistryError(`${label} contains unknown fields: ${unknown.join(", ")}`);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ProjectTagsRegistryError(`${label} must be a non-empty string`);
  }
  return value;
}

/** 계약 §3: 읽을 때는 Date.parse 가능한 값을 canonical로 받아들이고, 쓸 때는 canonical만 남긴다. */
function isoString(value: unknown, label: string): string {
  const raw = requiredString(value, label);
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) throw new ProjectTagsRegistryError(`${label} must be an ISO timestamp`);
  return new Date(parsed).toISOString();
}

function parseTagsRecord(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) throw new ProjectTagsRegistryError("Project tags must be an object");
  const tags: Record<string, string[]> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (id.length === 0) throw new ProjectTagsRegistryError("Project tags key must be a non-empty string");
    if (!Array.isArray(raw)) throw new ProjectTagsRegistryError(`Project tags for ${id} must be an array`);
    // 손편집 파일도 앱과 같은 답을 내도록 파서가 정규화까지 한다. 빈 배열은 **남긴다**(타입 주석 참고).
    tags[id] = normalizeTags(raw);
  }
  return tags;
}

export function parseProjectTags(value: unknown): ProjectTagsV1 {
  if (!isRecord(value)) throw new ProjectTagsRegistryError("Project tags registry must be an object");
  assertExactKeys(value, REGISTRY_KEYS, "Project tags registry");
  if (value.schemaVersion !== 1) {
    throw new ProjectTagsRegistryError(`Unsupported project tags schema: ${String(value.schemaVersion)}`);
  }
  return {
    schemaVersion: 1,
    updatedAt: isoString(value.updatedAt, "Project tags registry updatedAt"),
    tags: parseTagsRecord(value.tags),
  };
}

export function emptyProjectTags(now = new Date().toISOString()): ProjectTagsV1 {
  return { schemaVersion: 1, updatedAt: now, tags: {} };
}

const STORE: JsonStoreSpec<ProjectTagsV1> = {
  label: "project tags registry",
  parse: parseProjectTags,
  empty: () => emptyProjectTags(),
  error: (message, options) => new ProjectTagsRegistryError(message, options),
  isContentError: (error) => error instanceof ProjectTagsRegistryError,
};

export interface ProjectTagsOptions {
  registryPath?: string;
  lockRetryMs?: number;
  now?: () => string;
}

function registryPathOf(options: ProjectTagsOptions): string {
  return options.registryPath ?? PROJECT_TAGS_PATH;
}

function nowOf(options: ProjectTagsOptions): string {
  return (options.now ?? (() => new Date().toISOString()))();
}

export async function readProjectTags(options: ProjectTagsOptions = {}): Promise<ProjectTagsV1> {
  return (await readJsonStore(STORE, registryPathOf(options))).value;
}

export async function updateProjectTags(
  update: (registry: ProjectTagsV1) => ProjectTagsV1 | Promise<ProjectTagsV1>,
  options: ProjectTagsOptions = {},
): Promise<ProjectTagsV1> {
  return updateJsonStore(STORE, registryPathOf(options), update, {
    ...(options.lockRetryMs !== undefined ? { lockRetryMs: options.lockRetryMs } : {}),
  });
}

export async function restoreProjectTagsFromBackup(
  options: ProjectTagsOptions = {},
): Promise<ProjectTagsV1> {
  return restoreJsonStoreBackup(STORE, registryPathOf(options), {
    ...(options.lockRetryMs !== undefined ? { lockRetryMs: options.lockRetryMs } : {}),
  });
}

/** 태그를 한 업무 프로젝트에 통째로 심는다. 편집기가 저장할 때 쓰는 그 형태다. */
export async function setProjectTags(
  workProjectId: string,
  tags: readonly string[],
  options: ProjectTagsOptions = {},
): Promise<ProjectTagsV1> {
  const now = nowOf(options);
  return updateProjectTags((registry) => ({
    ...registry,
    updatedAt: now,
    // 정규화 결과가 비어도 행은 남는다 — "지웠다"와 "없다"를 구분하는 유일한 표식이다.
    tags: { ...registry.tags, [workProjectId]: normalizeTags(tags) },
  }), options);
}

/** 사라진 업무 프로젝트의 행을 지운다. `workspace:sync`가 매번 도는 경로다. */
export async function pruneProjectTags(
  knownIds: ReadonlySet<string>,
  options: ProjectTagsOptions = {},
): Promise<ProjectTagsV1> {
  const current = await readProjectTags(options);
  const stale = Object.keys(current.tags).filter((id) => !knownIds.has(id));
  // 버릴 게 없으면 잠금도 쓰기도 하지 않는다.
  if (stale.length === 0) return current;
  const now = nowOf(options);
  return updateProjectTags((registry) => ({
    ...registry,
    updatedAt: now,
    // 아이디로만 거른다 — 살아남는 업무 프로젝트의 빈 배열 행은 여기서도 지우지 않는다.
    tags: Object.fromEntries(Object.entries(registry.tags).filter(([id]) => knownIds.has(id))),
  }), options);
}
