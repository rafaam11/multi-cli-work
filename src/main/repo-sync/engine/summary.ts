// 출처: harness-manager src/main/services/repo-sync/summary.ts — 계약 harness-manager docs/contracts/repo-sync.md.
// HM이 없는 PC의 대체 구현이다. 판정 순서·잠금·state.json이 HM과 같아야 하므로 HM 쪽이 바뀌면 같이 고친다.
import path from "node:path";
import { REPO_FAIL_LABELS, REPO_SKIP_LABELS, type RepoResult } from "../../../shared/repo-sync-types";

function repoName(repoPath: string): string {
  // mcw: win32 규칙은 `\`와 `/`를 모두 구분자로 본다. posix의 basename은 Windows 경로를 통째로 돌려준다.
  return path.win32.basename(repoPath) || repoPath;
}

function joinNames(results: RepoResult[], describe: (result: RepoResult) => string): string {
  return results.map((result) => `${repoName(result.path)}(${describe(result)})`).join(", ");
}

/**
 * 세션 컨텍스트에 그대로 넣는 한 블록. 첫 줄이 숫자 요약이고, 사람이 손봐야 하는 레포(건너뜀·실패)는
 * 이름과 사유를 다음 줄에 적는다. 최신화된 레포는 커밋 수만 붙인다.
 */
export function summarizeRepoSync(
  results: RepoResult[],
  pending: string[] = [],
  /** `pending`을 부르는 말. 기록만 읽는 요약에서는 "기록 없음"이다. */
  pendingLabel = "진행 중",
): string {
  const total = results.length + pending.length;
  if (total === 0) return "최신화할 레포가 없습니다.";
  const updated = results.filter((result) => result.status === "updated");
  const upToDate = results.filter((result) => result.status === "up-to-date");
  const skipped = results.filter((result) => result.status === "skipped");
  const failed = results.filter((result) => result.status === "failed");

  const head = [`레포 ${total}개 중 ${updated.length}개 최신화`];
  if (upToDate.length > 0) head.push(`${upToDate.length}개 이미 최신`);
  if (skipped.length > 0) head.push(`${skipped.length}개 건너뜀`);
  if (failed.length > 0) head.push(`${failed.length}개 실패`);
  if (pending.length > 0) head.push(`${pending.length}개 ${pendingLabel}`);

  const lines = [head.join(", ")];
  if (updated.length > 0) lines.push(`- 최신화: ${joinNames(updated, (result) => `${result.commits ?? 0}커밋`)}`);
  if (skipped.length > 0) {
    lines.push(`- 건너뜀: ${joinNames(skipped, (result) => (result.reason ? REPO_SKIP_LABELS[result.reason] : "사유 없음"))}`);
  }
  if (failed.length > 0) {
    lines.push(`- 실패: ${joinNames(failed, (result) => (result.failKind ? REPO_FAIL_LABELS[result.failKind] : "오류"))}`);
  }
  if (pending.length > 0) lines.push(`- ${pendingLabel}: ${pending.map(repoName).join(", ")}`);
  return lines.join("\n");
}
