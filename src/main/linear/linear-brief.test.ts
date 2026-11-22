import { describe, expect, it } from "vitest";
import type { LinearIssueSummary, LinearProjectContext } from "../../shared/linear-types";
import { LINEAR_RECORD_MARKER, renderLinearBrief } from "./linear-brief";

function issue(overrides: Partial<LinearIssueSummary>): LinearIssueSummary {
  return { identifier: "SB-1", title: "제목", stateName: "할 일", stateType: "unstarted", dueDate: null, priority: 0, labels: [], ...overrides };
}

function context(overrides: Partial<LinearProjectContext> = {}): LinearProjectContext {
  return {
    name: "PRJ-0017 세컨드브레인",
    url: "https://linear.app/ws/project/x",
    issues: [
      issue({ identifier: "SB-41", title: "세션 브리프 Linear 절", stateName: "진행 중", dueDate: "2026-11-30", priority: 2, labels: ["repo:multi-cli-work", "할 일"] }),
      issue({ identifier: "SB-38", title: "판정표 채우기" }),
    ],
    updates: [{ health: "onTrack", body: "설계 승인\n세부 내용", createdAt: "2026-11-23T03:00:00.000Z" }],
    comments: [
      { issueIdentifier: "SB-38", body: "[메타몽] 브리핑 도착\n둘째 줄", createdAt: "2026-11-23T03:00:00.000Z" },
      { issueIdentifier: "SB-41", body: "[mcw-claude] 첫 기록", createdAt: "2026-11-22T03:00:00.000Z" },
    ],
    ...overrides,
  };
}

const fetchedAt = new Date(2026, 10, 23, 9, 12);

describe("renderLinearBrief", () => {
  it("renders header, health, issues, recent records and the CLI instruction", () => {
    const text = renderLinearBrief({ prjKey: "PRJ-0017", repoName: "multi-cli-work", context: context(), fetchedAt, recordReminder: false });
    const lines = text.split("\n");
    expect(lines[0]).toBe("## Linear 맥락 (PRJ-0017 세컨드브레인 · 조회 11-23 09:12)");
    expect(text).toContain('- 프로젝트 상태: 정상 — "설계 승인" (11-23)');
    expect(text).toContain("  - SB-41 [진행 중] 세션 브리프 Linear 절 · repo:multi-cli-work · 기한 11-30");
    expect(text).toContain("  - SB-38 [할 일] 판정표 채우기");
    expect(text).toContain('  - 11-23 SB-38 "[메타몽] 브리핑 도착"');
    expect(text).toContain("`linear --help`로 명령을 확인하고 `linear issue view <키>` 등으로 더 읽는다");
    expect(text).toContain("커밋·브랜치·PR에는 이슈 키를 넣는다");
    expect(text).not.toContain(LINEAR_RECORD_MARKER);
  });

  it("maps every health value", () => {
    const render = (health: LinearProjectContext["updates"][number]["health"]) =>
      renderLinearBrief({
        prjKey: "PRJ-0017",
        repoName: null,
        context: context({ updates: [{ health, body: "x", createdAt: "2026-11-23T03:00:00.000Z" }] }),
        fetchedAt,
        recordReminder: false,
      });
    expect(render("atRisk")).toContain("프로젝트 상태: 위험");
    expect(render("offTrack")).toContain("프로젝트 상태: 이탈");
    expect(render(null)).toContain("프로젝트 상태: 상태 없음");
  });

  it("orders issues by repo label, then priority (0 last), then due date (null last)", () => {
    const text = renderLinearBrief({
      prjKey: "PRJ-0017",
      repoName: "multi-cli-work",
      context: context({
        issues: [
          issue({ identifier: "A-1", priority: 0 }),
          issue({ identifier: "A-2", priority: 1, dueDate: "2026-12-10" }),
          issue({ identifier: "A-3", priority: 1, dueDate: "2026-12-01" }),
          issue({ identifier: "A-4", priority: 4, labels: ["repo:multi-cli-work"] }),
          issue({ identifier: "A-5", priority: 1 }),
        ],
      }),
      fetchedAt,
      recordReminder: false,
    });
    const order = [...text.matchAll(/ {2}- (A-\d)/g)].map((match) => match[1]);
    expect(order).toEqual(["A-4", "A-3", "A-2", "A-5", "A-1"]);
  });

  it("caps issues, titles and total lines", () => {
    const longTitle = "가".repeat(120);
    const text = renderLinearBrief({
      prjKey: "PRJ-0017",
      repoName: null,
      context: context({
        issues: Array.from({ length: 12 }, (_, index) => issue({ identifier: `B-${index}`, title: longTitle })),
        comments: Array.from({ length: 9 }, (_, index) => ({ issueIdentifier: `B-${index}`, body: "기록", createdAt: "2026-11-23T03:00:00.000Z" })),
      }),
      fetchedAt,
      recordReminder: true,
    });
    expect(text.match(/ {2}- B-\d+ \[/g)).toHaveLength(8);
    const titleLine = text.split("\n").find((line) => line.startsWith("  - B-0 "));
    const title = titleLine?.replace("  - B-0 [할 일] ", "") ?? "";
    expect(Array.from(title)).toHaveLength(80);
    expect(title.endsWith("…")).toBe(true);
    expect(text.match(/ {2}- 11-23 B-/g)?.length ?? 0).toBeLessThanOrEqual(5);
    expect(text.trimEnd().split("\n").length).toBeLessThanOrEqual(30);
  });

  it("appends the record marker only when recordReminder is true", () => {
    const on = renderLinearBrief({ prjKey: "PRJ-0017", repoName: null, context: context(), fetchedAt, recordReminder: true });
    expect(on.trimEnd().endsWith(LINEAR_RECORD_MARKER)).toBe(true);
  });

  it("writes 열린 이슈 없음 when there are no open issues", () => {
    const text = renderLinearBrief({ prjKey: "PRJ-0017", repoName: null, context: context({ issues: [], comments: [] }), fetchedAt, recordReminder: false });
    expect(text).toContain("- 열린 이슈 없음");
  });
});
