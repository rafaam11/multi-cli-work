import { RemoteClient, type RemoteSocketLike } from "../../shared/remote-client";
import { applySessionMessage } from "../../shared/remote-session-list";
import {
  REMOTE_STATUS_PROTOCOL_VERSION,
  type RemoteHostLink,
  type RemoteServerMessage,
  type RemoteSessionSummary,
} from "../../shared/remote-types";
import type { NotifiableStatus } from "../../shared/settings-types";
import type { TerminalStatus } from "../../shared/terminal-types";
import { createTerminalNotificationDeduper } from "../notification-policy";
import type { HostPairing } from "./host-registry";

export interface HostStatusNotice {
  hostId: string;
  hostName: string;
  sessionId: string;
  label: string;
  status: NotifiableStatus;
}

export interface HostStatusLinkOptions {
  host: HostPairing;
  createSocket(url: string): RemoteSocketLike;
  delaysMs?: readonly number[];
  /** 지금 알려도 되는지: 이 호스트의 알림 설정, 이 PC의 알림 설정, 그 호스트의 원격 창 포커스. */
  shouldNotify(status: NotifiableStatus): boolean;
  notify(notice: HostStatusNotice): void;
  /** 연결 상태나 대기 중인 세션 수가 바뀌었다. */
  onChange(): void;
  /** 호스트가 이 기기의 토큰을 거절했다(철회). 더 붙지 않는다. */
  onRejected(): void;
}

export interface HostStatusSnapshot {
  link: RemoteHostLink;
  awaiting: number;
}

const NOTIFIABLE: readonly TerminalStatus[] = ["awaiting-input", "awaiting-approval", "exited", "error"];

function isNotifiable(status: TerminalStatus): status is NotifiableStatus {
  return NOTIFIABLE.includes(status);
}

function isWaiting(status: TerminalStatus): boolean {
  return status === "awaiting-input" || status === "awaiting-approval";
}

/**
 * 다른 PC(호스트) 하나와 유지하는 상태 전용 연결. hello만 하고 어떤 세션에도 붙지 않는다 — 호스트는
 * 세션 목록과 상태 변화를 인증된 모든 연결에 보내고 터미널 출력은 붙은 세션에만 보내므로, 이것만으로
 * 출력 없이 상태만 받는다. 원격 창이 닫혀 있어도 그 PC의 세션이 사람을 기다리면 알릴 수 있다.
 *
 * 알림은 상태가 바뀌는 메시지에서만 낸다. 연결할 때 받는 목록에 이미 기다리는 세션이 있어도 알리지
 * 않는다 — 앱을 켤 때마다 알림이 쏟아지지 않게. 그 수는 대기 수로만 보인다.
 */
export class HostStatusLink {
  private readonly client: RemoteClient;
  private readonly deduper = createTerminalNotificationDeduper();
  private sessions: RemoteSessionSummary[] = [];
  private last: HostStatusSnapshot = { link: "connecting", awaiting: 0 };
  private unsubscribe: Array<() => void> = [];

  constructor(private readonly options: HostStatusLinkOptions) {
    this.client = new RemoteClient({
      url: `ws://${options.host.address}/ws`,
      token: options.host.token,
      createSocket: options.createSocket,
      delaysMs: options.delaysMs,
      protocolVersion: REMOTE_STATUS_PROTOCOL_VERSION,
    });
  }

  start(): void {
    this.unsubscribe = [
      this.client.onMessage((message) => this.receive(message)),
      this.client.onState((state) => {
        // 끊긴 동안의 일은 모른다. 다시 붙으면 호스트가 목록을 새로 준다.
        if (state !== "open") this.sessions = [];
        this.publish();
        if (state === "unauthorized") this.options.onRejected();
      }),
    ];
    this.client.connect();
  }

  close(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    this.client.close();
  }

  snapshot(): HostStatusSnapshot {
    const state = this.client.state();
    const link: RemoteHostLink = state === "unauthorized" ? "off" : state;
    return {
      link,
      awaiting: link === "open" ? this.sessions.filter((session) => isWaiting(session.status)).length : 0,
    };
  }

  private receive(message: RemoteServerMessage): void {
    if (message.type === "status") this.statusChanged(message.sessionId, message.status);
    const before = this.sessions;
    this.sessions = applySessionMessage(before, message);
    if (message.type === "sessions" || message.type === "removed") {
      const known = new Set(this.sessions.map((session) => session.id));
      for (const session of before) {
        if (!known.has(session.id)) this.deduper.reset(session.id);
      }
    }
    this.publish();
  }

  private statusChanged(sessionId: string, status: TerminalStatus): void {
    if (!isNotifiable(status)) {
      // 기다림이 풀렸다. 다음에 다시 기다리면 새 알림이다.
      this.deduper.reset(sessionId);
      return;
    }
    // 지금 알릴 수 없어 건너뛴 것은 알린 것으로 치지 않는다.
    if (!this.options.shouldNotify(status)) return;
    if (!this.deduper.shouldNotify(sessionId, status)) return;
    const session = this.sessions.find((candidate) => candidate.id === sessionId);
    this.options.notify({
      hostId: this.options.host.hostId,
      hostName: this.options.host.hostName,
      sessionId,
      label: session?.label ?? "세션",
      status,
    });
  }

  private publish(): void {
    const next = this.snapshot();
    if (next.link === this.last.link && next.awaiting === this.last.awaiting) return;
    this.last = next;
    this.options.onChange();
  }
}
