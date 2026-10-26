import os from "node:os";
import path from "node:path";
import type { RepoSyncReport, WorkProjectRepoSync } from "../../shared/repo-sync-types";
import { lastRepoSyncReport, startRepoSync, type RepoSyncOptions, type RepoSyncRun } from "./engine/runner";
import { repoSyncKey } from "./engine/paths";
import { findHmCli, runHmRepoSync, type HmCli, type HmRepoSyncInput } from "./hm-cli";

/** waitMs 없이 끝까지 기다리는 수동 실행의 상한. 레포마다 fetch 60초 + 반영 30초에 잠금 대기까지 넉넉히. */
const FULL_RUN_TIMEOUT_MS = 180_000;
/** spawn·기동 비용. HM이 waitMs에 맞춰 첫 줄을 쓰기까지 이만큼 더 기다린다(계약 §7). */
const SPAWN_GRACE_MS = 500;

/**
 * `~/.harness-manager` — HM 계약의 상태 폴더 부모. `HM_HOME`을 주면 그 아래를 쓴다(시험 격리, 계약 §1-1).
 * mcw가 HM 없이 돌 때도 같은 자리에 state.json·잠금을 남겨, 나중에 HM이 깔려도 쿨다운과 중복 제거가 이어진다.
 */
export function harnessManagerRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.HM_HOME ? path.resolve(env.HM_HOME) : os.homedir(), ".harness-manager");
}

export interface RepoSyncServiceOptions {
  /** 업무 프로젝트 → 레포 경로와 표시 이름. 프로젝트가 없으면 null. */
  resolve(workProjectId: string): Promise<{ label: string; paths: string[] } | null>;
  root?: string;
  findCli?: (root: string) => Promise<HmCli | null>;
  runCli?: (cli: HmCli, input: HmRepoSyncInput, timeoutMs: number) => Promise<RepoSyncReport | null>;
  startFallback?: (options: RepoSyncOptions) => RepoSyncRun;
  platform?: NodeJS.Platform;
}

export interface SyncRequest {
  /** 수동 버튼. 쿨다운을 무시한다. */
  force: boolean;
  /** 세션 시작: 이 시간이 지나면 그때까지의 보고서를 돌려주고, 남은 레포는 뒤에서 마저 돈다. */
  waitMs?: number;
}

export interface RepoSyncService {
  sync(workProjectId: string, request: SyncRequest): Promise<WorkProjectRepoSync | null>;
  /** 네트워크 없이 state.json의 마지막 기록. */
  last(workProjectId: string): Promise<WorkProjectRepoSync | null>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref?.());
}

export function createRepoSyncService(options: RepoSyncServiceOptions): RepoSyncService {
  const root = options.root ?? harnessManagerRoot();
  const stateDir = path.join(root, "repo-sync");
  const findCli = options.findCli ?? findHmCli;
  const runCli = options.runCli ?? runHmRepoSync;
  const startFallback = options.startFallback ?? startRepoSync;
  const platform = options.platform ?? process.platform;
  /**
   * 같은 업무 프로젝트의 겹친 호출을 하나로 묶는다 — 세션을 여러 개 한꺼번에 띄워도 HM CLI는 한 번만
   * 뜬다. 레포 단위 중복 제거는 그 아래에서 엔진(프로세스 안 inFlight + 레포별 파일 잠금)이 다시 한다.
   */
  const inFlight = new Map<string, { force: boolean; promise: Promise<WorkProjectRepoSync | null> }>();

  const last = async (paths: string[], label: string, source: WorkProjectRepoSync["source"]) => {
    const report = await lastRepoSyncReport(paths, stateDir, platform);
    return { report: { ...report, label }, source };
  };

  const run = async (label: string, paths: string[], request: SyncRequest): Promise<WorkProjectRepoSync | null> => {
    const cli = await findCli(root);
    if (cli) {
      const timeoutMs = request.waitMs === undefined ? FULL_RUN_TIMEOUT_MS : request.waitMs + SPAWN_GRACE_MS;
      const report = await runCli(
        cli,
        { paths, label, force: request.force, ...(request.waitMs === undefined ? {} : { waitMs: request.waitMs }) },
        timeoutMs,
      );
      if (report) return { report, source: "hm" };
      // HM이 있는데 답이 없으면 대체 구현으로 내려가지 않는다 — 그 프로세스가 아직 같은 레포를 돌고 있을 수
      // 있어서다. 마지막 기록을 보여 주고 끝낸다.
      return last(paths, label, "hm").catch(() => null);
    }
    const fallback = startFallback({ paths, label, force: request.force, stateDir, platform });
    if (request.waitMs === undefined) return { report: await fallback.done, source: "fallback" };
    await Promise.race([fallback.done, sleep(request.waitMs)]);
    return { report: fallback.snapshot(), source: "fallback" };
  };

  return {
    async sync(workProjectId, request) {
      const target = await options.resolve(workProjectId);
      if (!target || target.paths.length === 0) return null;
      const key = target.paths.map((candidate) => repoSyncKey(candidate, platform)).join("|");
      const running = inFlight.get(key);
      // 진행 중인 실행이 쿨다운을 지킨 것이라면 버튼(force)은 그 뒤에 다시 돈다. 반대는 그대로 같이 기다린다.
      if (running && (running.force || !request.force)) return running.promise;
      const promise = (running ? running.promise.catch(() => null) : Promise.resolve(null))
        .then(() => run(target.label, target.paths, request))
        .catch(() => null)
        .finally(() => {
          if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
        });
      inFlight.set(key, { force: request.force, promise });
      return promise;
    },
    async last(workProjectId) {
      const target = await options.resolve(workProjectId);
      if (!target || target.paths.length === 0) return null;
      const cli = await findCli(root);
      return last(target.paths, target.label, cli ? "hm" : "fallback");
    },
  };
}
