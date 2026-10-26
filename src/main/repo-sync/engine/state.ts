// 출처: harness-manager src/main/services/repo-sync/state.ts — 계약 harness-manager docs/contracts/repo-sync.md.
// HM이 없는 PC의 대체 구현이다. 판정 순서·잠금·state.json이 HM과 같아야 하므로 HM 쪽이 바뀌면 같이 고친다.
import path from "node:path";
import type { RepoFailKind, RepoResult, RepoSkipReason, RepoSyncStatus } from "../../../shared/repo-sync-types";
import { readJsonStore, updateJsonStore, type JsonStoreSpec } from "../../storage/json-store";

export interface RepoSyncState {
  schemaVersion: 1;
  updatedAt: string;
  /** `repoSyncKey(path)` → 그 레포의 마지막 결과. */
  repos: Record<string, RepoResult>;
}

class RepoSyncStateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RepoSyncStateError";
  }
}

const STATUSES: readonly RepoSyncStatus[] = ["updated", "up-to-date", "skipped", "failed"];
const REASONS: readonly RepoSkipReason[] = [
  "missing",
  "not-a-repo",
  "cloud-sync",
  "detached",
  "no-upstream",
  "dirty",
  "in-progress-op",
  "diverged",
];
const FAIL_KINDS: readonly RepoFailKind[] = ["network", "auth", "timeout", "overwrite", "git"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new RepoSyncStateError(`${field} must be a string`);
  return value;
}

function optionalCount(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new RepoSyncStateError(`${field} must be a non-negative integer`);
  }
  return value;
}

/**
 * 모르는 키는 버리고 읽는다. exact-keys로 거부하면 필드를 하나 늘린 새 버전 뒤에 옛 버전이 파일 전체를
 * 못 읽는다(multi-cli-work registry-contract §8의 함정). 아는 필드는 형태를 검사한다.
 */
export function parseRepoResult(value: unknown): RepoResult {
  if (!isRecord(value)) throw new RepoSyncStateError("Repo result must be an object");
  if (typeof value.path !== "string" || !value.path) throw new RepoSyncStateError("path must be a non-empty string");
  if (!STATUSES.includes(value.status as RepoSyncStatus)) throw new RepoSyncStateError("status is invalid");
  if (value.reason !== undefined && !REASONS.includes(value.reason as RepoSkipReason)) {
    throw new RepoSyncStateError("reason is invalid");
  }
  if (value.failKind !== undefined && !FAIL_KINDS.includes(value.failKind as RepoFailKind)) {
    throw new RepoSyncStateError("failKind is invalid");
  }
  if (!isIso(value.finishedAt)) throw new RepoSyncStateError("finishedAt must be an ISO timestamp");
  const result: RepoResult = {
    path: value.path,
    status: value.status as RepoSyncStatus,
    finishedAt: new Date(Date.parse(value.finishedAt)).toISOString(),
    cached: value.cached === true,
  };
  if (value.reason !== undefined) result.reason = value.reason as RepoSkipReason;
  if (value.failKind !== undefined) result.failKind = value.failKind as RepoFailKind;
  const error = optionalString(value.error, "error");
  if (error !== undefined) result.error = error;
  const branch = optionalString(value.branch, "branch");
  if (branch !== undefined) result.branch = branch;
  const upstream = optionalString(value.upstream, "upstream");
  if (upstream !== undefined) result.upstream = upstream;
  for (const field of ["commits", "ahead", "behind"] as const) {
    const count = optionalCount(value[field], field);
    if (count !== undefined) result[field] = count;
  }
  return result;
}

export function parseRepoSyncState(value: unknown): RepoSyncState {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new RepoSyncStateError("schemaVersion must be 1");
  if (!isIso(value.updatedAt)) throw new RepoSyncStateError("updatedAt must be an ISO timestamp");
  if (!isRecord(value.repos)) throw new RepoSyncStateError("repos must be an object");
  const repos: Record<string, RepoResult> = {};
  for (const [key, result] of Object.entries(value.repos)) repos[key] = parseRepoResult(result);
  return { schemaVersion: 1, updatedAt: new Date(Date.parse(value.updatedAt)).toISOString(), repos };
}

const STATE_SPEC: JsonStoreSpec<RepoSyncState> = {
  label: "repo sync state",
  displayName: "레포 최신화 기록(state.json)",
  parse: parseRepoSyncState,
  empty: () => ({ schemaVersion: 1, updatedAt: new Date(0).toISOString(), repos: {} }),
  error: (message, options) => new RepoSyncStateError(message, options),
  isContentError: (error) => error instanceof RepoSyncStateError,
};

export function stateFilePath(stateDir: string): string {
  return path.join(stateDir, "state.json");
}

/** 기록이 망가져도 최신화는 돌아야 한다 — 읽기 실패는 "기록 없음"으로 본다. */
export async function readRepoSyncState(stateDir: string): Promise<RepoSyncState> {
  try {
    return (await readJsonStore(STATE_SPEC, stateFilePath(stateDir))).value;
  } catch {
    return STATE_SPEC.empty();
  }
}

export async function recordRepoResult(stateDir: string, key: string, result: RepoResult, now: Date): Promise<void> {
  await updateJsonStore(STATE_SPEC, stateFilePath(stateDir), (current) => ({
    schemaVersion: 1 as const,
    updatedAt: now.toISOString(),
    // 저장본의 cached는 늘 false다 — "이번 호출에서 재사용했는가"는 읽는 쪽이 정한다.
    repos: { ...current.repos, [key]: { ...result, cached: false } },
  }));
}
