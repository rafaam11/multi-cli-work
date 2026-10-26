// @vitest-environment node
// 출처: harness-manager src/main/services/repo-sync/summary.test.ts — 계약 harness-manager docs/contracts/repo-sync.md.
// HM이 없는 PC의 대체 구현이다. 판정 순서·잠금·state.json이 HM과 같아야 하므로 HM 쪽이 바뀌면 같이 고친다.
import { describe, expect, it } from "vitest";
import type { RepoResult } from "../../../shared/repo-sync-types";
import { isCloudSynced, parseMountPoints } from "./cloud";
import { isWithin, repoSyncKey } from "./paths";
import { summarizeRepoSync } from "./summary";

const at = "2026-10-26T00:00:00.000Z";
const result = (fields: Partial<RepoResult> & Pick<RepoResult, "path" | "status">): RepoResult => ({
  finishedAt: at,
  cached: false,
  ...fields,
});

describe("summarizeRepoSync", () => {
  it("숫자 요약 한 줄 뒤에 손봐야 할 레포의 이름과 사유를 적는다", () => {
    const text = summarizeRepoSync([
      result({ path: "D:\\dev\\alpha", status: "updated", commits: 2 }),
      result({ path: "D:\\dev\\beta", status: "up-to-date" }),
      result({ path: "D:\\dev\\sample-app", status: "skipped", reason: "dirty" }),
      result({ path: "D:\\dev\\gamma", status: "failed", failKind: "auth" }),
    ]);
    expect(text).toBe(
      [
        "레포 4개 중 1개 최신화, 1개 이미 최신, 1개 건너뜀, 1개 실패",
        "- 최신화: alpha(2커밋)",
        "- 건너뜀: sample-app(로컬 변경)",
        "- 실패: gamma(인증 실패)",
      ].join("\n"),
    );
  });

  it("진행 중인 레포를 세고 이름을 남긴다", () => {
    expect(summarizeRepoSync([result({ path: "/r/a", status: "up-to-date" })], ["/r/b"])).toBe(
      "레포 2개 중 0개 최신화, 1개 이미 최신, 1개 진행 중\n- 진행 중: b",
    );
    expect(summarizeRepoSync([])).toBe("최신화할 레포가 없습니다.");
  });
});

describe("경로 키와 클라우드 판정", () => {
  it("Windows에서는 대소문자·구분자·후행 구분자를 하나로 모은다", () => {
    expect(repoSyncKey("D:/Dev/Repo/", "win32")).toBe("d:\\dev\\repo");
    expect(repoSyncKey("D:\\", "win32")).toBe("d:\\");
    expect(isWithin("C:\\Users\\me\\OneDrive", "c:/users/me/onedrive/work/repo", "win32")).toBe(true);
    expect(isWithin("C:\\Users\\me\\One", "C:\\Users\\me\\OneDrive\\repo", "win32")).toBe(false);
  });

  it("Google Drive 폴더 이름, OneDrive·Teams 마운트 지점, 사용자 제외 경로를 잡는다", () => {
    expect(isCloudSynced("G:\\내 드라이브\\code\\repo", [], [], "win32")).toBe(true);
    expect(isCloudSynced("G:\\Shared drives\\team\\repo", [], [], "win32")).toBe(true);
    const roots = parseMountPoints("C:\\Users\\me\\Org\\Site - Documents\r\nC:\\Users\\me\\OneDrive\r\n\r\n");
    expect(roots).toEqual(["C:\\Users\\me\\Org\\Site - Documents", "C:\\Users\\me\\OneDrive"]);
    expect(isCloudSynced("C:\\Users\\me\\Org\\Site - Documents\\repo", roots, [], "win32")).toBe(true);
    expect(isCloudSynced("D:\\dev\\repo", roots, ["D:\\dev\\private"], "win32")).toBe(false);
    expect(isCloudSynced("D:\\dev\\private\\repo", roots, ["D:\\dev\\private"], "win32")).toBe(true);
  });
});
