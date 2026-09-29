/**
 * 모바일 컴패니언과 데스크톱 호스트가 주고받는 것. 와이어 메시지(WS)와, 설정 탭이 쓰는 데스크톱
 * API 타입을 한곳에 둔다. 설계: docs/superpowers/specs/2026-09-30-mobile-companion-design.md §5.
 */
import type { TerminalKind, TerminalStatus } from "./terminal-types";

export const REMOTE_PROTOCOL_VERSION = 1;

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
  | { type: "releaseSize"; sessionId: string };

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
