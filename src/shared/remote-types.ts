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

/**
 * 호스트 PC 앞에 사람이 있는지(v1.37.0). focused: 앱 창에 포커스가 있고 최근 입력이 있다 · active: PC를
 * 쓰고 있지만 다른 창이다 · away: 자리를 비웠거나 잠겼다. 폰은 focused일 때 알림을 생략한다.
 */
export type DesktopPresence = "focused" | "active" | "away";

/** PC 설치본에 동봉된 셸 APK. 폰은 이 값으로 자기 업데이트 여부를 정한다. */
export interface ShellRelease {
  versionCode: number;
  versionName: string;
  sha256: string;
}

export interface RemoteAttentionState { generation: number; seenThrough: number }

export interface RemoteSessionSummary {
  attention?: RemoteAttentionState;
  id: string;
  projectId: string | null;
  projectName: string | null;
  kind: TerminalKind;
  label: string;
  status: TerminalStatus;
  updatedAt: string;
  /** 워크트리에서 도는 세션이면 그 브랜치(v1.38.0 호스트부터). */
  worktreeBranch?: string;
  /** 호스트 메인 창의 숨김 선반에 있는 세션이면 true. 없으면 작업공간 세션이다. */
  hidden?: boolean;
  cwd?: string;
  projectRootPath?: string;
}

/** 호스트 메인 창의 두 선반. 세션은 둘 중 하나에만 있다. */
export type RemoteShelf = "active" | "hidden";

/** 미러 트리의 worktree 줄. 세션은 id만 싣는다 — 이름·상태는 sessions 목록이 이미 갖고 있다. */
export interface RemoteMirrorWorktree {
  id: string;
  /** 사이드바가 그 줄에 쓰는 이름 그대로(PR 리뷰면 "PR #n · 임시"). */
  branch: string;
  changedFileCount: number;
  sessionIds: string[];
}

export interface RemoteMirrorFolder {
  id: string;
  name: string;
  missing: boolean;
  role?: "docs" | "repo";
  /** 이 폴더(그 worktree 포함)의 모든 세션. 폴더 줄의 수와 대기 점이 여기서 나온다. */
  sessionIds: string[];
  /** git 폴더면 메인 줄. null이면 세션이 폴더 바로 아래에 선다. */
  main: { branch: string; changedFileCount: number } | null;
  /** 폴더 루트(git이면 메인)의 세션. */
  rootSessionIds: string[];
  worktrees: RemoteMirrorWorktree[];
}

export interface RemoteMirrorSection {
  /** null이면 미분류다. */
  workProject: { id: string; name: string } | null;
  folders: RemoteMirrorFolder[];
}

/** 호스트 그리드가 보여 주는 곳. other는 홈·상세 페이지처럼 그리드가 아닌 화면이다. */
export type RemoteMirrorPlace =
  | { kind: "folder"; projectId: string; worktreeId: string | null }
  | { kind: "shelf"; shelf: RemoteShelf }
  | { kind: "other" };

export type RemoteMirrorSlot = { kind: "session"; id: string } | { kind: "document"; id: string; label: string } | null;

/** 호스트 그리드의 지금 페이지. 슬롯 번호는 이 페이지 안의 번호다 — 호스트 그리드와 같다. */
export interface RemoteMirrorView {
  place: RemoteMirrorPlace;
  layoutId: string;
  /** 그리는 모양. 자동이면 자동이 고른 열들이다. */
  columnRows: number[];
  page: number;
  pages: number;
  focusedPaneId: string | null;
  slots: RemoteMirrorSlot[];
}

/** 호스트 메인 창이 보여 주는 것: 사이드바의 프로젝트 트리와 그리드. 창이 없으면 null로 온다. */
export interface RemoteMirror {
  tree: RemoteMirrorSection[];
  view: RemoteMirrorView;
}

/** 원격이 호스트 그리드에 요청하는 조작. 슬롯은 지금 페이지 안의 번호다. */
export type RemoteViewAction =
  | { action: "select-folder"; projectId: string; worktreeId: string | null }
  | { action: "select-shelf"; shelf: RemoteShelf }
  | { action: "layout"; layoutId: string }
  | { action: "split"; slot: number }
  | { action: "merge"; slot: number }
  | { action: "page"; page: number }
  | { action: "focus"; paneId: string }
  | { action: "close"; slot: number }
  | { action: "move"; paneId: string; slot: number }
  | { action: "open"; sessionId: string };

/** 원격이 고를 수 있는 레이아웃: 자동, 또는 나누지 않은 1~6열. 나누기는 칸에서 한다. */
const REMOTE_LAYOUT_ID = /^(auto|cols:1(-1){0,5})$/;
/** 한 페이지의 칸 수 상한(6열 × 2행). */
const MAX_REMOTE_SLOT = 12;
/** 세션 이름 길이 상한. 메인 창의 IPC와 같다. */
export const REMOTE_SESSION_NAME_MAX = 120;

export type RemoteClientMessage =
  | { type: "hello"; token: string; protocolVersion: number; mode: "ui" }
  | { type: "list" }
  | { type: "attach"; sessionId: string }
  | { type: "detach"; sessionId: string }
  | { type: "seen"; sessionId: string; generation: number }
  | { type: "write"; sessionId: string; data: string }
  | { type: "resize"; sessionId: string; cols: number; rows: number }
  | { type: "releaseSize"; sessionId: string }
  // 세션 관리. 새 세션의 크기는 만드는 화면이 어림해 보낸다. 없으면 호스트 기본 크기로 띄운다.
  | { type: "catalog" }
  | { type: "create"; projectId: string; kind: TerminalKind; worktreeId?: string; cols?: number; rows?: number }
  | { type: "stop"; sessionId: string }
  | { type: "resume"; sessionId: string }
  | { type: "remove"; sessionId: string }
  // 호스트 메인 창에서 숨기거나 다시 표시한다. 바뀐 목록은 sessions로 다시 온다.
  | { type: "shelf"; sessionId: string; shelf: RemoteShelf }
  // 호스트 메인 창의 그리드를 바꾼다. 결과는 mirror로 다시 온다.
  | ({ type: "view" } & RemoteViewAction)
  // 빈 이름이면 사용자가 붙인 이름을 지운다.
  | { type: "rename"; sessionId: string; name: string };

/**
 * 새 세션을 어디에 무엇으로 띄울 수 있는지. 숨긴 폴더와 실행 파일이 없는 에이전트는 들어 있지 않다.
 * 폴더마다 그 안에서 고를 수 있는 워크트리가 딸려 온다(v1.38.0).
 */
export interface RemoteCatalog {
  projects: Array<{ id: string; name: string; worktrees: Array<{ id: string; branch: string }> }>;
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
      capabilities?: string[];
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
      scrollback?: number;
    }
  | { type: "data"; sessionId: string; data: string; sequence: number }
  /** presence는 v1.37.0 호스트부터 싣는다. 없으면 클라이언트는 away로 본다. */
  | { type: "status"; sessionId: string; status: TerminalStatus; presence?: DesktopPresence; attention?: RemoteAttentionState }
  | { type: "seen"; sessionId: string; attention: RemoteAttentionState }
  | { type: "title"; sessionId: string; title: string }
  | { type: "exit"; sessionId: string; exitCode: number }
  | { type: "created"; session: RemoteSessionSummary }
  | { type: "workspace"; session: RemoteSessionSummary }
  | { type: "size"; sessionId: string; cols: number; rows: number; sizeOwner: SizeOwner }
  | ({ type: "catalog" } & RemoteCatalog)
  /** create·resume을 보낸 연결에만 간다 — 그 화면이 이 세션을 연다. */
  | { type: "started"; sessionId: string }
  | { type: "removed"; sessionId: string }
  /** 접속 직후와 호스트 화면이 바뀔 때마다. 구버전 호스트는 보내지 않는다. */
  | { type: "mirror"; mirror: RemoteMirror | null }
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

function slotIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < MAX_REMOTE_SLOT;
}

function parseViewAction(value: Record<string, unknown>): RemoteViewAction | null {
  switch (value.action) {
    case "select-folder":
      if (!text(value.projectId)) return null;
      if (value.worktreeId !== null && !text(value.worktreeId)) return null;
      return { action: "select-folder", projectId: value.projectId, worktreeId: value.worktreeId };
    case "select-shelf":
      return value.shelf === "active" || value.shelf === "hidden" ? { action: "select-shelf", shelf: value.shelf } : null;
    case "layout":
      return typeof value.layoutId === "string" && REMOTE_LAYOUT_ID.test(value.layoutId)
        ? { action: "layout", layoutId: value.layoutId }
        : null;
    case "split":
    case "merge":
    case "close":
      return slotIndex(value.slot) ? { action: value.action, slot: value.slot } : null;
    case "page":
      return typeof value.page === "number" && Number.isInteger(value.page) && value.page >= 0
        ? { action: "page", page: value.page }
        : null;
    case "focus":
      return text(value.paneId) ? { action: "focus", paneId: value.paneId } : null;
    case "move":
      return text(value.paneId) && slotIndex(value.slot) ? { action: "move", paneId: value.paneId, slot: value.slot } : null;
    case "open":
      return text(value.sessionId) ? { action: "open", sessionId: value.sessionId } : null;
    default:
      return null;
  }
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
    case "seen":
      return text(value.sessionId) && typeof value.generation === "number" && Number.isSafeInteger(value.generation) && value.generation >= 0
        ? { type: "seen", sessionId: value.sessionId, generation: value.generation } : null;
    case "releaseSize":
      return text(value.sessionId) ? { type: "releaseSize", sessionId: value.sessionId } : null;
    case "catalog":
      return { type: "catalog" };
    case "create":
      if (!text(value.projectId) || typeof value.kind !== "string" || !AGENT_ID_PATTERN.test(value.kind)) return null;
      if (value.worktreeId !== undefined && !text(value.worktreeId)) return null;
      return {
        type: "create",
        projectId: value.projectId,
        kind: value.kind,
        ...(value.worktreeId !== undefined ? { worktreeId: value.worktreeId } : {}),
        ...(dimension(value.cols) && dimension(value.rows) ? { cols: value.cols, rows: value.rows } : {}),
      };
    case "stop":
      return text(value.sessionId) ? { type: "stop", sessionId: value.sessionId } : null;
    case "resume":
      return text(value.sessionId) ? { type: "resume", sessionId: value.sessionId } : null;
    case "remove":
      return text(value.sessionId) ? { type: "remove", sessionId: value.sessionId } : null;
    case "shelf":
      return text(value.sessionId) && (value.shelf === "active" || value.shelf === "hidden")
        ? { type: "shelf", sessionId: value.sessionId, shelf: value.shelf }
        : null;
    case "view": {
      const action = parseViewAction(value);
      return action ? { type: "view", ...action } : null;
    }
    case "rename":
      return text(value.sessionId) && typeof value.name === "string" && value.name.length <= REMOTE_SESSION_NAME_MAX
        ? { type: "rename", sessionId: value.sessionId, name: value.name }
        : null;
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
