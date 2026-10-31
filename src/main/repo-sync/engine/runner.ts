// 출처: harness-manager src/main/services/repo-sync/runner.ts — 계약 harness-manager docs/contracts/repo-sync.md.
// HM이 없는 PC의 대체 구현이다. 판정 순서·잠금·state.json이 HM과 같아야 하므로 HM 쪽이 바뀌면 같이 고친다.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import type { RepoResult, RepoSyncReport } from "../../../shared/repo-sync-types";
import { readCloudRoots } from "./cloud";
import type { GitRunner } from "./git";
import { repoSyncKey } from "./paths";
import { readRepoSyncSettings } from "./settings";
import { readRepoSyncState, recordRepoResult } from "./state";
import { summarizeRepoSync } from "./summary";
import { syncRepo } from "./sync-repo";

export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_COOLDOWN_MS = 10 * 60_000;
/** 다른 프로세스가 같은 레포를 돌리는 동안 기다리는 한도. fetch 60초 + 반영 30초보다 길어야 한다. */
export const DEFAULT_LOCK_WAIT_MS = 120_000;

export interface RepoSyncOptions {
  paths: string[];
  /** 수동 버튼: 쿨다운을 무시한다. 다른 실행과의 중복 제거는 그대로다. */
  force?: boolean;
  label?: string;
  concurrency?: number;
  cooldownMs?: number;
  lockWaitMs?: number;
  /** `~/.harness-manager/repo-sync`. 결과(state.json)·잠금(locks/)·설정(config.json)이 산다. */
  stateDir: string;
  git?: GitRunner;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  now?: () => Date;
  /** 테스트용. 주지 않으면 환경변수와 OneDrive 레지스트리에서 읽는다. */
  cloudRoots?: string[];
  onResult?: (result: RepoResult) => void;
}

export interface RepoSyncRun {
  /** 지금까지 끝난 결과로 만든 보고서. 남은 레포는 `pending`이다. */
  snapshot(): RepoSyncReport;
  /** 모든 레포가 끝나면 풀린다. reject하지 않는다. */
  done: Promise<RepoSyncReport>;
}

/**
 * 같은 프로세스 안에서 같은 레포를 두 번 돌리지 않는다. 앱 버튼과 세션 시작이 겹쳐도 한 번의 실행을 같이 기다린다.
 */
const inFlight = new Map<string, Promise<RepoResult>>();

function isFresh(result: RepoResult | undefined, now: Date, cooldownMs: number): result is RepoResult {
  if (!result || (result.status !== "updated" && result.status !== "up-to-date")) return false;
  return now.getTime() - Date.parse(result.finishedAt) < cooldownMs;
}

export function lockTarget(stateDir: string, key: string): string {
  return path.join(stateDir, "locks", crypto.createHash("sha1").update(key).digest("hex"));
}

/**
 * 프로세스 사이의 중복 제거. 앱, hm-cli, multi-cli-work 대체 구현이 같은 레포를 동시에 만지면 index.lock이
 * 부딪친다. 레포마다 잠금 하나를 두고, 기다리는 동안 다른 쪽이 끝낸 결과는 다시 돌리지 않고 받아 쓴다.
 */
async function acquireRepoLock(target: string, waitMs: number): Promise<() => Promise<void>> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  return lockfile.lock(target, {
    realpath: false,
    lockfilePath: `${target}.lock`,
    stale: 10_000,
    update: 5_000,
    retries: { retries: Math.max(1, Math.ceil(waitMs / 200)), factor: 1, minTimeout: 200, maxTimeout: 200 },
    // 잠금 갱신이 한 번 늦었다고 프로세스를 죽이지 않는다. 최악은 같은 레포의 git이 겹쳐 한쪽이 실패하는 것이다.
    onCompromised: () => undefined,
  });
}

async function runPool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await work(item as T);
    }
  });
  await Promise.all(workers);
}

export function startRepoSync(options: RepoSyncOptions): RepoSyncRun {
  const now = options.now ?? (() => new Date());
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const lockWaitMs = options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS;
  const startedAt = now().toISOString();

  // 같은 레포를 다른 표기로 두 번 받아도 한 줄로 처리한다. 순서는 처음 나온 자리를 따른다.
  const targets: { key: string; path: string }[] = [];
  const seen = new Set<string>();
  for (const candidate of options.paths) {
    const key = repoSyncKey(candidate, platform);
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ key, path: path.resolve(candidate) });
  }

  const results = new Map<string, RepoResult>();
  const report = (): RepoSyncReport => {
    const finished = targets.flatMap((target) => results.get(target.key) ?? []);
    const pending = targets.filter((target) => !results.has(target.key)).map((target) => target.path);
    return {
      schemaVersion: 1,
      ...(options.label ? { label: options.label } : {}),
      startedAt,
      finishedAt: now().toISOString(),
      results: finished,
      pending,
      summary: summarizeRepoSync(finished, pending),
    };
  };

  const done = (async () => {
    const [state, settings, cloudRoots] = await Promise.all([
      readRepoSyncState(options.stateDir),
      readRepoSyncSettings(options.stateDir),
      options.cloudRoots ? Promise.resolve(options.cloudRoots) : readCloudRoots(env, platform),
    ]);

    const runOne = async (target: { key: string; path: string }): Promise<RepoResult> => {
      const previous = state.repos[target.key];
      if (!options.force && isFresh(previous, now(), cooldownMs)) return { ...previous, path: target.path, cached: true };

      const waitingSince = now().getTime();
      let release: () => Promise<void>;
      try {
        release = await acquireRepoLock(lockTarget(options.stateDir, target.key), lockWaitMs);
      } catch {
        return {
          path: target.path,
          status: "failed",
          failKind: "timeout",
          error: "같은 레포의 다른 최신화가 끝나지 않음",
          finishedAt: now().toISOString(),
          cached: false,
        };
      }
      try {
        // 잠금을 기다리는 사이 다른 프로세스가 끝낸 결과가 있으면 그것을 쓴다(쿨다운과 무관한 중복 제거).
        const latest = (await readRepoSyncState(options.stateDir)).repos[target.key];
        if (latest && Date.parse(latest.finishedAt) >= waitingSince) return { ...latest, path: target.path, cached: true };

        const result = await syncRepo(target.path, {
          git: options.git,
          cloudRoots,
          excludePaths: settings.excludePaths,
          now,
          platform,
        });
        // 기록 실패는 결과를 바꾸지 않는다. 다음 호출이 쿨다운·중복 제거를 못 받을 뿐이다.
        await recordRepoResult(options.stateDir, target.key, result, now()).catch(() => undefined);
        return result;
      } finally {
        await release().catch(() => undefined);
      }
    };

    await runPool(targets, options.concurrency ?? DEFAULT_CONCURRENCY, async (target) => {
      let running = inFlight.get(target.key);
      if (!running) {
        running = runOne(target).finally(() => inFlight.delete(target.key));
        inFlight.set(target.key, running);
      }
      const result = await running.catch(
        (error: unknown): RepoResult => ({
          path: target.path,
          status: "failed",
          failKind: "git",
          error: error instanceof Error ? error.message : String(error),
          finishedAt: now().toISOString(),
          cached: false,
        }),
      );
      results.set(target.key, result);
      options.onResult?.(result);
    });
    return report();
  })();

  return { snapshot: report, done };
}

export async function syncRepos(options: RepoSyncOptions): Promise<RepoSyncReport> {
  return startRepoSync(options).done;
}

/** 네트워크 없이 마지막 기록만으로 만든 보고서. 기록이 없는 레포는 `pending`으로 둔다. */
export async function lastRepoSyncReport(
  paths: string[],
  stateDir: string,
  platform: NodeJS.Platform = process.platform,
  now: () => Date = () => new Date(),
): Promise<RepoSyncReport> {
  const state = await readRepoSyncState(stateDir);
  const results: RepoResult[] = [];
  const pending: string[] = [];
  const seen = new Set<string>();
  for (const candidate of paths) {
    const key = repoSyncKey(candidate, platform);
    if (seen.has(key)) continue;
    seen.add(key);
    const recorded = state.repos[key];
    if (recorded) results.push({ ...recorded, path: path.resolve(candidate), cached: true });
    else pending.push(path.resolve(candidate));
  }
  const at = now().toISOString();
  return {
    schemaVersion: 1,
    startedAt: at,
    finishedAt: at,
    results,
    pending,
    summary: summarizeRepoSync(results, pending, "기록 없음"),
  };
}
