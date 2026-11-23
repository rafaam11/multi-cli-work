import type {
  LinearCommentSummary,
  LinearHealth,
  LinearIssueSummary,
  LinearProjectContext,
  LinearUpdateSummary,
} from "../../shared/linear-types";

const LINEAR_API = "https://api.linear.app/graphql";
const LINEAR_TIMEOUT_MS = 15_000;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface LinearClientOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
}

export type LinearFetchResult =
  | { kind: "ok"; context: LinearProjectContext }
  | { kind: "no-project" }
  | { kind: "unauthorized" }
  | { kind: "rate-limited" }
  | { kind: "rejected" }
  | { kind: "network-error" };

export type LinearFailureKind = Exclude<LinearFetchResult["kind"], "ok">;

const FAILURE_MESSAGES: Record<LinearFailureKind, string> = {
  unauthorized: "Linear API 키가 거부됐습니다",
  "rate-limited": "Linear 요청 한도에 걸렸습니다. 잠시 후 다시 시도하세요",
  "network-error": "Linear에 연결할 수 없습니다",
  rejected: "Linear가 조회를 거부했습니다(쿼리 오류)",
  "no-project": "이 PRJ의 Linear 프로젝트를 찾지 못했습니다",
};

export function linearFailureMessage(kind: LinearFailureKind): string {
  return FAILURE_MESSAGES[kind];
}

const VIEWER_QUERY = "query { viewer { id } }";

/**
 * 한 번의 질의로 프로젝트·열린 이슈·업데이트·댓글을 가져온다(설계 §4.3). Linear는 연결 필드를 `first`(기본 50)로
 * 곱해 복잡도를 세고 10,000점을 넘으면 거부한다 — 모든 연결에 `first`를 단다(대략 3 × 50 × 17 ≈ 2,600점).
 */
const PROJECT_QUERY = `query($prjKey: String!) {
  projects(filter: { name: { startsWith: $prjKey } }, first: 3) {
    nodes {
      name
      url
      projectUpdates(first: 2) { nodes { health body createdAt } }
      issues(first: 50, filter: { state: { type: { nin: ["completed", "canceled"] } } }) {
        nodes {
          identifier title dueDate priority
          state { name type }
          labels(first: 10) { nodes { name } }
          comments(first: 3) { nodes { body createdAt } }
        }
      }
    }
  }
}`;

type SendResult =
  | { kind: "ok"; data: unknown }
  | { kind: "unauthorized" }
  | { kind: "rate-limited" }
  | { kind: "rejected" }
  | { kind: "network-error" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCodes(body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.errors)) return [];
  return body.errors.map((error) =>
    isRecord(error) && isRecord(error.extensions) && typeof error.extensions.code === "string" ? error.extensions.code : "",
  );
}

async function send(key: string, query: string, variables: Record<string, unknown>, options: LinearClientOptions): Promise<SendResult> {
  const call = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? LINEAR_TIMEOUT_MS);
  try {
    const response = await call(LINEAR_API, {
      method: "POST",
      // 개인 API 키는 Bearer 없이 그대로 보낸다(Bearer는 OAuth 토큰용).
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) return { kind: "unauthorized" };
    if (response.status === 429) return { kind: "rate-limited" };
    const body: unknown = await response.json();
    const codes = errorCodes(body);
    if (codes.includes("AUTHENTICATION_ERROR")) return { kind: "unauthorized" };
    if (codes.includes("RATELIMITED")) return { kind: "rate-limited" };
    // 인증·한도 밖의 GraphQL 오류(복잡도 초과·필드 오류)는 연결 문제가 아니다 — 사유를 따로 보여 준다.
    if (codes.length > 0) return { kind: "rejected" };
    if (!response.ok || !isRecord(body)) return { kind: "network-error" };
    return { kind: "ok", data: body.data };
  } catch {
    // 타임아웃(abort)·DNS·오프라인·JSON 아님이 전부 여기로 온다. 원문은 버린다 — 키가 섞일 여지를 없앤다.
    return { kind: "network-error" };
  } finally {
    clearTimeout(timer);
  }
}

/** 설정 화면에서 키를 저장하기 전에 부른다. 실패 사유를 한국어 메시지로 던진다. */
export async function verifyLinearKey(key: string, options: LinearClientOptions = {}): Promise<void> {
  const result = await send(key, VIEWER_QUERY, {}, options);
  if (result.kind === "ok") return;
  throw new Error(linearFailureMessage(result.kind));
}

function nodes(value: unknown): unknown[] {
  return isRecord(value) && Array.isArray(value.nodes) ? value.nodes : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function health(value: unknown): LinearHealth | null {
  return value === "onTrack" || value === "atRisk" || value === "offTrack" ? value : null;
}

/** 이름이 정확히 그 키로 시작하고 그 뒤가 공백이거나 끝인 프로젝트만 같은 PRJ다(`PRJ-00170` 배제). */
function isExactKey(name: string, prjKey: string): boolean {
  return /^PRJ-\d{4}(\s|$)/.test(name) && name.slice(0, prjKey.length) === prjKey;
}

function toContext(project: Record<string, unknown>): LinearProjectContext {
  const issues: LinearIssueSummary[] = [];
  const comments: LinearCommentSummary[] = [];
  for (const issue of nodes(project.issues)) {
    if (!isRecord(issue)) continue;
    const state = isRecord(issue.state) ? issue.state : {};
    const identifier = text(issue.identifier);
    issues.push({
      identifier,
      title: text(issue.title),
      stateName: text(state.name),
      stateType: text(state.type),
      dueDate: typeof issue.dueDate === "string" ? issue.dueDate : null,
      priority: typeof issue.priority === "number" ? issue.priority : 0,
      labels: nodes(issue.labels).map((label) => (isRecord(label) ? text(label.name) : "")).filter((name) => name.length > 0),
    });
    for (const comment of nodes(issue.comments)) {
      if (isRecord(comment)) comments.push({ issueIdentifier: identifier, body: text(comment.body), createdAt: text(comment.createdAt) });
    }
  }
  comments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const updates: LinearUpdateSummary[] = nodes(project.projectUpdates)
    .filter(isRecord)
    .map((update) => ({ health: health(update.health), body: text(update.body), createdAt: text(update.createdAt) }));
  return { name: text(project.name), url: text(project.url), issues, updates, comments };
}

export async function fetchLinearProjectContext(
  key: string,
  prjKey: string,
  options: LinearClientOptions = {},
): Promise<LinearFetchResult> {
  const result = await send(key, PROJECT_QUERY, { prjKey }, options);
  if (result.kind !== "ok") return result;
  const projects = isRecord(result.data) ? nodes(result.data.projects) : [];
  const project = projects.find((candidate) => isRecord(candidate) && isExactKey(text(candidate.name), prjKey));
  return isRecord(project) ? { kind: "ok", context: toContext(project) } : { kind: "no-project" };
}
