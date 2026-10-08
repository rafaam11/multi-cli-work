/**
 * 모바일 컴패니언과 데스크톱 호스트가 주고받는 것. 와이어 메시지(WS)와, 설정 탭이 쓰는 데스크톱
 * API 타입을 한곳에 둔다. 설계: docs/superpowers/specs/2026-09-30-mobile-companion-design.md §5.
 */
import { AGENT_ID_PATTERN } from "./agent-types";
import type { TerminalKind, TerminalStatus } from "./terminal-types";

/**
 * 버전 규칙. 호스트가 서빙하는 웹 UI와 호스트는 같은 빌드라 어긋날 일이 없다. 어긋날 수 있는 것은
 * 다른 PC의 main이 유지하는 상태 연결뿐이다(두 PC의 앱 버전이 다를 수 있다). 그래서:
 * - 서버 메시지는 추가만 한다. 클라이언트는 모르는 type을 무시한다.
 * - 호스트는 MIN 이상 CURRENT 이하의 hello를 받는다.
 * - 상태 연결은 언제나 REMOTE_STATUS_PROTOCOL_VERSION으로 hello를 보낸다.
 */
export const REMOTE_PROTOCOL_VERSION = 1;
export const REMOTE_MIN_PROTOCOL_VERSION = 1;
/** 상태 연결이 보내는 버전. 앱이 올라가도 올리지 않는다 — 구버전 호스트에도 붙어야 한다. */
export const REMOTE_STATUS_PROTOCOL_VERSION = 1;

/**
 * WS close 코드. 4401·4403이면 클라이언트는 재연결하지 않고 다시 페어링하게 한다 — 토큰이 확실히
 * 틀렸을 때만 쓴다. 4408은 hello 지연·호스트 쪽 오류·버퍼 초과처럼 "잠시 뒤 다시"인 경우다.
 */
export const REMOTE_CLOSE = { protocol: 4400, unauthorized: 4401, revoked: 4403, retry: 4408 } as const;

/** 크기를 가진 쪽: 데스크톱이거나, 크기를 가져간 기기의 deviceId. */
export type SizeOwner = string;
export const DESKTOP_SIZE_OWNER = "desktop";

/** PC 설치본에 동봉된 셸 APK. 폰은 이 값으로 자기 업데이트 여부를 정한다. */
export interface ShellRelease {
  versionCode: number;
  versionName: string;
  sha256: string;
}

export interface RemoteSessionSummary {
  id: string;
  projectId: string | null;
  projectName: string | null;
  kind: TerminalKind;
  label: string;
  status: TerminalStatus;
  updatedAt: string;
}

export type RemoteClientMessage =
  | { type: "hello"; token: string; protocolVersion: number; mode: "ui" }
  | { type: "list" }
  | { type: "attach"; sessionId: string }
  | { type: "detach"; sessionId: string }
  | { type: "write"; sessionId: string; data: string }
  | { type: "resize"; sessionId: string; cols: number; rows: number }
  | { type: "releaseSize"; sessionId: string }
  // 세션 관리. 새 세션의 크기는 만드는 화면이 어림해 보낸다. 없으면 호스트 기본 크기로 띄운다.
  | { type: "catalog" }
  | { type: "create"; projectId: string; kind: TerminalKind; cols?: number; rows?: number }
  | { type: "stop"; sessionId: string }
  | { type: "resume"; sessionId: string }
  | { type: "remove"; sessionId: string };

/** 새 세션을 어디에 무엇으로 띄울 수 있는지. 숨긴 폴더와 실행 파일이 없는 에이전트는 들어 있지 않다. */
export interface RemoteCatalog {
  projects: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; label: string }>;
}

export type RemoteErrorCode = "bad-message" | "protocol" | "unauthorized" | "not-attached" | "failed";

export type RemoteServerMessage =
  | {
      type: "welcome";
      hostId: string;
      hostName: string;
      deviceId: string;
      protocolVersion: number;
      shellLatest: ShellRelease | null;
    }
  | { type: "sessions"; sessions: RemoteSessionSummary[] }
  | {
      type: "attached";
      sessionId: string;
      replay: string;
      sequence: number;
      cols: number | null;
      rows: number | null;
      sizeOwner: SizeOwner;
    }
  | { type: "data"; sessionId: string; data: string; sequence: number }
  | { type: "status"; sessionId: string; status: TerminalStatus }
  | { type: "title"; sessionId: string; title: string }
  | { type: "exit"; sessionId: string; exitCode: number }
  | { type: "created"; session: RemoteSessionSummary }
  | { type: "size"; sessionId: string; cols: number; rows: number; sizeOwner: SizeOwner }
  | ({ type: "catalog" } & RemoteCatalog)
  /** create·resume을 보낸 연결에만 간다 — 그 화면이 이 세션을 연다. */
  | { type: "started"; sessionId: string }
  | { type: "removed"; sessionId: string }
  | { type: "error"; code: RemoteErrorCode; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function dimension(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** 잘못된 입력은 null — 연결 하나의 나쁜 메시지가 서버를 던지게 두지 않는다. */
export function parseRemoteClientMessage(raw: string): RemoteClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "hello":
      return text(value.token) && typeof value.protocolVersion === "number" && value.mode === "ui"
        ? { type: "hello", token: value.token, protocolVersion: value.protocolVersion, mode: "ui" }
        : null;
    case "list":
      return { type: "list" };
    case "attach":
      return text(value.sessionId) ? { type: "attach", sessionId: value.sessionId } : null;
    case "detach":
      return text(value.sessionId) ? { type: "detach", sessionId: value.sessionId } : null;
    case "releaseSize":
      return text(value.sessionId) ? { type: "releaseSize", sessionId: value.sessionId } : null;
    case "catalog":
      return { type: "catalog" };
    case "create":
      if (!text(value.projectId) || typeof value.kind !== "string" || !AGENT_ID_PATTERN.test(value.kind)) return null;
      return dimension(value.cols) && dimension(value.rows)
        ? { type: "create", projectId: value.projectId, kind: value.kind, cols: value.cols, rows: value.rows }
        : { type: "create", projectId: value.projectId, kind: value.kind };
    case "stop":
      return text(value.sessionId) ? { type: "stop", sessionId: value.sessionId } : null;
    case "resume":
      return text(value.sessionId) ? { type: "resume", sessionId: value.sessionId } : null;
    case "remove":
      return text(value.sessionId) ? { type: "remove", sessionId: value.sessionId } : null;
    case "write":
      return text(value.sessionId) && typeof value.data === "string"
        ? { type: "write", sessionId: value.sessionId, data: value.data }
        : null;
    case "resize":
      return text(value.sessionId) && dimension(value.cols) && dimension(value.rows)
        ? { type: "resize", sessionId: value.sessionId, cols: value.cols, rows: value.rows }
        : null;
    default:
      return null;
  }
}

/** 설정 탭이 보는 서버 상태. */
export interface RemoteAccessStatus {
  state: "off" | "listening" | "no-tailscale" | "error";
  /** listening일 때 폰에서 열 주소, 예: http://100.101.102.103:47821/mobile/ */
  url: string | null;
  port: number;
  message: string | null;
}

export interface RemotePairingCode {
  /** 표시용 "ABCD-EFGH". 입력할 때 하이픈과 대소문자는 무시한다. */
  code: string;
  expiresAt: string;
  url: string;
  /** 셸 앱이 스캔하는 QR 내용. */
  pairUri: string;
  /** 처음 설치할 때 폰 브라우저로 여는 주소. */
  installUrl: string;
}

export interface RemoteDeviceInfo {
  deviceId: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
}

/** POST /pair 성공 응답. */
export interface RemotePairResponse {
  token: string;
  deviceId: string;
  hostId: string;
  hostName: string;
}

/** 이 PC가 클라이언트로서 등록해 둔 다른 PC. 토큰은 main 밖으로 나가지 않는다. */
export interface RemoteHostInfo {
  hostId: string;
  name: string;
  /** "100.x.y.z:47821" */
  address: string;
  notify: boolean;
  /** false면 호스트가 이 기기를 거절했다 — 다시 페어링해야 한다. */
  paired: boolean;
  addedAt: string;
}

/** "PC 추가" 입력: 접속 주소와 코드, 또는 호스트 설정에서 복사한 mcw://pair 링크. */
export type RemoteHostAddInput = { address: string; code: string } | { uri: string };

/** 이 PC의 main이 호스트와 유지하는 상태 연결. off는 링크가 없다는 뜻이다(다시 페어링해야 하는 호스트). */
export type RemoteHostLink = "off" | "connecting" | "open" | "reconnecting" | "incompatible";

/** 렌더러가 보는 호스트: 등록 정보에 지금의 연결 상태와 대기 중인 세션 수를 더한 것. */
export interface RemoteHostView extends RemoteHostInfo {
  link: RemoteHostLink;
  /** 입력·승인을 기다리는 세션 수. 연결이 끊긴 동안은 모르므로 0이다. */
  awaiting: number;
}
