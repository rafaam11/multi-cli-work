import type { LinearHealth, LinearIssueSummary, LinearProjectContext } from "../../shared/linear-types";

/**
 * 이 절이 실렸고 기록 리마인드가 켜졌다는 표식. Claude 상태 훅이 브리프 파일에서 이 문자열을 찾아
 * Stop 리마인드를 켠다 — 훅 스크립트에 그대로 박히므로 ASCII여야 한다.
 */
export const LINEAR_RECORD_MARKER = "<!-- mcw:linear-record -->";

const MAX_ISSUES = 8;
const MAX_UPDATES = 2;
const MAX_COMMENTS = 5;
const MAX_LINES = 30;
const TITLE_MAX = 80;
const UPDATE_MAX = 80;
const COMMENT_MAX = 60;

const HEALTH_LABEL: Record<LinearHealth, string> = { onTrack: "정상", atRisk: "위험", offTrack: "이탈" };

function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
}

function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0]?.trim() ?? "";
}

const pad = (value: number) => String(value).padStart(2, "0");

/** 로컬 시간대 기준 `MM-DD`. */
function monthDay(date: Date): string {
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isoMonthDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : monthDay(date);
}

/** 기한은 날짜만 있는 값(`2026-11-30`)이라 시간대 변환 없이 자른다. */
function dueMonthDay(dueDate: string): string {
  return dueDate.slice(5, 10);
}

function compareIssues(repoLabel: string | null) {
  const rank = (issue: LinearIssueSummary) => (issue.priority === 0 ? 5 : issue.priority);
  const ownRepo = (issue: LinearIssueSummary) => (repoLabel !== null && issue.labels.includes(repoLabel) ? 0 : 1);
  return (a: LinearIssueSummary, b: LinearIssueSummary): number => {
    if (ownRepo(a) !== ownRepo(b)) return ownRepo(a) - ownRepo(b);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.dueDate === b.dueDate) return 0;
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  };
}

function issueLine(issue: LinearIssueSummary): string {
  const parts = [`${issue.identifier} [${issue.stateName}] ${truncate(issue.title, TITLE_MAX)}`];
  const repos = issue.labels.filter((label) => label.startsWith("repo:"));
  if (repos.length > 0) parts.push(repos.join(" "));
  if (issue.dueDate) parts.push(`기한 ${dueMonthDay(issue.dueDate)}`);
  return `  - ${parts.join(" · ")}`;
}

export interface LinearBriefInput {
  prjKey: string;
  repoName: string | null;
  context: LinearProjectContext;
  fetchedAt: Date;
  recordReminder: boolean;
}

/** 세션 브리프의 "Linear 맥락" 절(설계 §4.4). 전체 30줄을 넘지 않는다. */
export function renderLinearBrief(input: LinearBriefInput): string {
  const { context } = input;
  const repoLabel = input.repoName ? `repo:${input.repoName}` : null;
  const header = `## Linear 맥락 (${context.name} · 조회 ${monthDay(input.fetchedAt)} ${pad(input.fetchedAt.getHours())}:${pad(input.fetchedAt.getMinutes())})`;

  const updates = context.updates.slice(0, MAX_UPDATES).map((update, index) => {
    const label = update.health ? HEALTH_LABEL[update.health] : "상태 없음";
    const prefix = index === 0 ? "- 프로젝트 상태" : "- 지난 업데이트";
    return `${prefix}: ${label} — "${truncate(firstLine(update.body), UPDATE_MAX)}" (${isoMonthDay(update.createdAt)})`;
  });
  if (updates.length === 0) updates.push("- 프로젝트 상태: 업데이트 없음");

  let issues = [...context.issues].sort(compareIssues(repoLabel)).slice(0, MAX_ISSUES).map(issueLine);
  let comments = context.comments
    .slice(0, MAX_COMMENTS)
    .map((comment) => `  - ${isoMonthDay(comment.createdAt)} ${comment.issueIdentifier} "${truncate(firstLine(comment.body), COMMENT_MAX)}"`);

  const footer = [
    "",
    "더 필요하면 `linear --help`로 명령을 확인하고 `linear issue view <키>` 등으로 더 읽는다.",
    "작업 단위가 끝나면 해당 이슈에 댓글 1건(첫 줄 `[mcw-<cli>]`)으로 진행·결정·막힘·다음 할 일을 남긴다. 새 이슈를 만들면 라벨 `repo:<레포>`를 붙인다.",
    "커밋·브랜치·PR에는 이슈 키를 넣는다(Linear의 GitHub 연동이 상태를 옮긴다).",
    ...(input.recordReminder ? [LINEAR_RECORD_MARKER] : []),
  ];

  const assemble = () => [
    header,
    ...updates,
    ...(issues.length > 0 ? ["- 열린 이슈", ...issues] : ["- 열린 이슈 없음"]),
    ...(comments.length > 0 ? ["- 최근 기록", ...comments] : []),
    ...footer,
  ];
  // 30줄을 넘으면 댓글부터, 그다음 이슈를 줄인다.
  while (assemble().length > MAX_LINES && comments.length > 0) comments = comments.slice(0, -1);
  while (assemble().length > MAX_LINES && issues.length > 0) issues = issues.slice(0, -1);
  return `${assemble().join("\n")}\n`;
}
