// 출처: harness-manager src/main/services/repo-sync/sync-repo.ts — 계약 harness-manager docs/contracts/repo-sync.md.
// HM이 없는 PC의 대체 구현이다. 판정 순서·잠금·state.json이 HM과 같아야 하므로 HM 쪽이 바뀌면 같이 고친다.
import fs from "node:fs/promises";
import path from "node:path";
import type { RepoResult, RepoSkipReason } from "../../../shared/repo-sync-types";
import { isCloudSynced } from "./cloud";
import {
  classifyGitFailure,
  FETCH_TIMEOUT_MS,
  MERGE_TIMEOUT_MS,
  parseBranchStatus,
  QUERY_TIMEOUT_MS,
  runGit,
  type GitRunner,
} from "./git";
import { repoSyncKey } from "./paths";

export interface SyncRepoOptions {
  git?: GitRunner;
  cloudRoots?: readonly string[];
  excludePaths?: readonly string[];
  now?: () => Date;
  platform?: NodeJS.Platform;
}

/** 이 상태 파일이 있으면 사람이 하던 merge·rebase·cherry-pick이 멈춰 있는 것이다. */
const IN_PROGRESS_MARKERS = ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD"];

async function exists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * git이 돌려준 최상위와 받은 경로가 같은 폴더인가. 문자열만 비교하면 junction·심볼릭 링크로 가리킨 레포나
 * 8.3 짧은 이름(`C:\Users\RUNNER~1\…`)으로 받은 경로를 "레포 아님"으로 잘못 본다. 둘 다 실제 경로로 푼 뒤 비교한다.
 */
async function sameLocation(a: string, b: string, platform: NodeJS.Platform): Promise<boolean> {
  const real = (value: string) => fs.realpath(value).catch(() => value);
  const [left, right] = await Promise.all([real(a), real(b)]);
  return repoSyncKey(left, platform) === repoSyncKey(right, platform);
}

function parseLeftRight(output: string): { ahead: number; behind: number } | null {
  const match = /^(\d+)\s+(\d+)\s*$/.exec(output.trim());
  return match ? { ahead: Number(match[1]), behind: Number(match[2]) } : null;
}

/**
 * 레포 하나를 fast-forward로만 최신화한다. 판정 순서와 사유 코드가 계약이다(docs/contracts/repo-sync.md §3) —
 * multi-cli-work의 대체 구현도 이 순서를 그대로 따른다.
 *
 * 쓰는 명령은 `fetch --prune`과 `merge --ff-only @{u}` 둘뿐이다. reset·force·clean·stash·rebase는 없다.
 * 어떤 실패도 throw하지 않고 결과에 담는다 — 호출자는 세션 시작을 막으면 안 된다.
 */
export async function syncRepo(repoPath: string, options: SyncRepoOptions = {}): Promise<RepoResult> {
  const git = options.git ?? runGit;
  const now = options.now ?? (() => new Date());
  const platform = options.platform ?? process.platform;
  const resolved = path.resolve(repoPath);
  const finish = (fields: Omit<RepoResult, "path" | "finishedAt" | "cached">): RepoResult => ({
    path: resolved,
    ...fields,
    finishedAt: now().toISOString(),
    cached: false,
  });
  const skip = (reason: RepoSkipReason, extra: Partial<RepoResult> = {}): RepoResult =>
    finish({ status: "skipped", reason, ...extra });

  if (!(await isDirectory(resolved))) return skip("missing");
  // 경로 문자열만으로 판정할 수 있는 것은 git을 부르기 전에 거른다.
  if (isCloudSynced(resolved, options.cloudRoots ?? [], options.excludePaths ?? [], platform)) return skip("cloud-sync");

  let gitDir: string;
  try {
    const toplevel = (await git(resolved, ["rev-parse", "--show-toplevel"], QUERY_TIMEOUT_MS)).trim();
    // 레포 안의 하위 폴더를 받으면 엉뚱한 범위를 최신화하게 된다. 최상위만 받는다.
    if (!toplevel || !(await sameLocation(toplevel, resolved, platform))) return skip("not-a-repo");
    gitDir = (await git(resolved, ["rev-parse", "--absolute-git-dir"], QUERY_TIMEOUT_MS)).trim();
  } catch {
    return skip("not-a-repo");
  }

  let status;
  try {
    status = parseBranchStatus(
      await git(resolved, ["status", "--porcelain=v2", "--branch", "--untracked-files=no", "-z"], QUERY_TIMEOUT_MS),
    );
  } catch (error) {
    return finish({ status: "failed", ...classifyGitFailure(error) });
  }
  const branchFields = {
    ...(status.branch ? { branch: status.branch } : {}),
    ...(status.upstream ? { upstream: status.upstream } : {}),
  };
  if (!status.branch) return skip("detached");
  if (!status.upstream) return skip("no-upstream", branchFields);
  for (const marker of IN_PROGRESS_MARKERS) {
    if (await exists(path.join(gitDir, marker))) return skip("in-progress-op", branchFields);
  }
  // 추적 안 된 파일은 막지 않는다. ff-only가 그 파일을 덮어써야 하면 git이 스스로 멈추고 overwrite 실패가 된다.
  if (status.trackedChanges > 0) return skip("dirty", branchFields);

  try {
    await git(resolved, ["fetch", "--prune"], FETCH_TIMEOUT_MS);
  } catch (error) {
    return finish({ status: "failed", ...branchFields, ...classifyGitFailure(error) });
  }

  let counts: { ahead: number; behind: number } | null;
  try {
    counts = parseLeftRight(await git(resolved, ["rev-list", "--left-right", "--count", "HEAD...@{u}"], QUERY_TIMEOUT_MS));
  } catch {
    // prune으로 원격 브랜치가 사라지면 @{u}를 풀 수 없다. 따라갈 곳이 없으니 upstream 없음과 같다.
    return skip("no-upstream", branchFields);
  }
  if (!counts) return finish({ status: "failed", failKind: "git", error: "rev-list 출력을 읽지 못함", ...branchFields });
  const { ahead, behind } = counts;
  if (behind === 0) return finish({ status: "up-to-date", ahead, behind, ...branchFields });
  if (ahead > 0) return skip("diverged", { ahead, behind, ...branchFields });

  try {
    // pull --ff-only와 결과가 같지만 방금 받은 원격 상태를 그대로 반영해 네트워크를 한 번만 탄다.
    await git(resolved, ["merge", "--ff-only", "@{u}"], MERGE_TIMEOUT_MS);
  } catch (error) {
    return finish({ status: "failed", ahead, behind, ...branchFields, ...classifyGitFailure(error) });
  }
  return finish({ status: "updated", commits: behind, ahead: 0, behind: 0, ...branchFields });
}
