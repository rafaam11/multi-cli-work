import { notionLinkCheck, type NotionLinkCheck } from "../../shared/notion-types";
import { parseNotionLink } from "./notion-link";

const NOTION_API = "https://api.notion.com/v1";
/**
 * 고정 버전. 2025-09-03부터 데이터베이스가 data source로 갈라지면서 응답 모양이 달라진다 —
 * 여기서 필요한 건 제목 한 줄뿐이라 안정된 옛 버전을 계속 쓴다.
 */
const NOTION_VERSION = "2022-06-28";
const NOTION_TIMEOUT_MS = 15_000;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface NotionClientOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
}

type SendResult =
  | { kind: "ok"; body: unknown }
  | { kind: "not-found" }
  | { kind: "unauthorized" }
  | { kind: "rate-limited" }
  | { kind: "network-error" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function send(token: string, pathname: string, options: NotionClientOptions): Promise<SendResult> {
  const call = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? NOTION_TIMEOUT_MS);
  try {
    const response = await call(`${NOTION_API}${pathname}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION },
      signal: controller.signal,
    });
    // 403(restricted_resource)은 토큰 자체의 권한 문제라 401과 같은 안내를 준다.
    if (response.status === 401 || response.status === 403) return { kind: "unauthorized" };
    if (response.status === 404) return { kind: "not-found" };
    if (response.status === 429) return { kind: "rate-limited" };
    if (!response.ok) return { kind: "network-error" };
    return { kind: "ok", body: await response.json() };
  } catch {
    // 타임아웃(abort)·DNS·오프라인이 전부 여기로 온다. 토큰이 섞일 여지가 없도록 원문은 버린다.
    return { kind: "network-error" };
  } finally {
    clearTimeout(timer);
  }
}

function richText(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const text = value
    .map((part) => (isRecord(part) && typeof part.plain_text === "string" ? part.plain_text : ""))
    .join("")
    .trim();
  return text.length > 0 ? text : null;
}

function pageTitle(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.properties)) return null;
  for (const property of Object.values(body.properties)) {
    if (isRecord(property) && property.type === "title") return richText(property.title);
  }
  return null;
}

function databaseTitle(body: unknown): string | null {
  return isRecord(body) ? richText(body.title) : null;
}

/** 설정 화면에서 토큰을 저장하기 전에 부른다. 실패 사유를 한국어 메시지로 던진다. */
export async function verifyNotionToken(token: string, options: NotionClientOptions = {}): Promise<void> {
  const result = await send(token, "/users/me", options);
  if (result.kind === "ok") return;
  throw new Error(notionLinkCheck(result.kind === "not-found" ? "unauthorized" : result.kind).message ?? "노션에 연결할 수 없습니다");
}

/**
 * 제목 조회 겸 접근성 검증. 페이지가 아니면 데이터베이스로 한 번 더 물어본다 —
 * 링크만 봐서는 둘을 구분할 수 없다.
 */
export async function inspectNotionLink(
  token: string,
  url: string,
  options: NotionClientOptions = {},
): Promise<NotionLinkCheck> {
  const target = parseNotionLink(url);
  if (!target) return notionLinkCheck("not-notion");

  const page = await send(token, `/pages/${target.id}`, options);
  if (page.kind === "ok") return notionLinkCheck("ok", pageTitle(page.body));
  if (page.kind !== "not-found") return notionLinkCheck(page.kind);

  const database = await send(token, `/databases/${target.id}`, options);
  if (database.kind === "ok") return notionLinkCheck("ok", databaseTitle(database.body));
  // 노션은 권한 없는 리소스의 존재 자체를 숨긴다 — 404는 "없음"이 아니라 "통합에 안 보임"으로 읽는다.
  return notionLinkCheck(database.kind === "not-found" ? "not-shared" : database.kind);
}
