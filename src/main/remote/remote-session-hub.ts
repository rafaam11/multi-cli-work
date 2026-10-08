import type { TerminalAttachResult, TerminalSessionView } from "../../shared/api-types";
import { DEFAULT_TERMINAL_SIZE, type TerminalEvent } from "../../shared/terminal-types";
import {
  parseRemoteClientMessage,
  REMOTE_CLOSE,
  REMOTE_MIN_PROTOCOL_VERSION,
  REMOTE_PROTOCOL_VERSION,
  type DesktopPresence,
  type RemoteCatalog,
  type RemoteClientMessage,
  type RemoteServerMessage,
  type RemoteSessionSummary,
  type ShellRelease,
} from "../../shared/remote-types";
import type { RemoteDevice } from "./device-store";
import type { SizeState, TerminalSizeArbiter } from "./size-arbiter";

export interface RemoteHubGateway {
  list(): TerminalSessionView[];
  /** 데스크톱의 attachForRenderer와 같되 크기를 넘기지 않는다 — 폰이 붙는다고 PTY 크기가 바뀌면 안 된다. */
  attach(sessionId: string): Promise<TerminalAttachResult>;
  write(sessionId: string, data: string): Promise<void>;
  onEvent(listener: (event: TerminalEvent) => void): () => void;
  projectName(projectId: string): Promise<string | null>;
  /** 워크트리의 브랜치. 목록에서 워크트리 세션을 구별하게 한다. */
  worktreeBranch?(worktreeId: string): Promise<string | null>;
  /** 새 세션을 띄울 수 있는 폴더와 에이전트. */
  catalog(): Promise<RemoteCatalog>;
  /** 호스트 데스크톱의 선택·그리드를 건드리지 않고 시작한다. */
  create(input: { projectId: string; kind: string; worktreeId?: string; cols: number; rows: number }): Promise<TerminalSessionView>;
  resume(input: { sessionId: string; cols: number; rows: number }): Promise<TerminalSessionView>;
  stop(sessionId: string): Promise<void>;
  /** 지울 수 없는 세션(진행 중인 PR 리뷰)이면 이유를 담아 거절한다. */
  remove(sessionId: string): Promise<void>;
  /** 호스트 PC 앞에 사람이 있는지. 상태가 바뀔 때마다 함께 보낸다 — 폰이 알림을 생략할지 정한다. */
  presence?(): DesktopPresence;
}

export interface RemoteHubDevices {
  verify(token: string): Promise<RemoteDevice | null>;
  touch(deviceId: string): Promise<void>;
}

export interface RemoteConnection {
  send(message: RemoteServerMessage): void;
  close(code: number, reason: string): void;
  /** 소켓에 쌓여 아직 못 보낸 바이트. 없으면 흐름 제어를 하지 않는다. */
  bufferedAmount?(): number;
}

/** 폰이 이만큼 못 받고 밀리면 끊는다 — 다시 붙으면 replay가 화면을 되살린다. */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
/** 원격에서 만드는 세션의 시작 크기 범위. 화면 어림이 엉뚱해도 쓸 수 있는 터미널이 되게 자른다. */
const CREATE_COLS = { min: 20, max: 400 };
const CREATE_ROWS = { min: 5, max: 200 };

function clamp(value: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, value));
}

export interface RemoteClientHandle {
  receive(raw: string): void;
  closed(): void;
}

export interface RemoteHubOptions {
  gateway: RemoteHubGateway;
  devices: RemoteHubDevices;
  sizes: TerminalSizeArbiter;
  hostId(): Promise<string>;
  hostName: string;
  helloTimeoutMs?: number;
  shellLatest?: () => ShellRelease | null;
}

interface Client {
  connection: RemoteConnection;
  device: RemoteDevice | null;
  /** 철회·강제 종료된 연결. 소켓이 닫히는 동안 도착한 메시지도 더는 처리하지 않는다. */
  closed: boolean;
  attached: Set<string>;
  helloTimer: ReturnType<typeof setTimeout>;
}

export function toSessionSummary(
  view: TerminalSessionView,
  projectName: string | null,
  worktreeBranch: string | null = null,
): RemoteSessionSummary {
  return {
    id: view.id,
    projectId: view.projectId,
    projectName,
    kind: view.kind,
    label: view.name ?? view.title ?? view.kind,
    status: view.status,
    updatedAt: view.updatedAt,
    ...(worktreeBranch ? { worktreeBranch } : {}),
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 모바일 연결 하나하나의 프로토콜을 소켓과 떼어 둔 곳. 서버(remote-server.ts)는 바이트를 옮기고,
 * 여기는 인증·세션 붙기·입력·크기만 다룬다. 한 연결의 메시지는 도착 순서대로 하나씩 처리한다.
 */
export class RemoteSessionHub {
  private readonly clients = new Set<Client>();
  private readonly unsubscribes: Array<() => void>;

  constructor(private readonly options: RemoteHubOptions) {
    this.unsubscribes = [
      options.gateway.onEvent((event) => this.forward(event)),
      options.sizes.onChange((sessionId, state) => this.broadcastSize(sessionId, state)),
    ];
  }

  open(connection: RemoteConnection): RemoteClientHandle {
    const client: Client = {
      connection,
      device: null,
      closed: false,
      attached: new Set(),
      helloTimer: setTimeout(
        () => connection.close(REMOTE_CLOSE.retry, "hello timeout"),
        this.options.helloTimeoutMs ?? 10_000,
      ),
    };
    this.clients.add(client);
    let queue = Promise.resolve();
    return {
      receive: (raw) => {
        queue = queue
          .then(() => this.handle(client, raw))
          .catch((error) => {
            if (client.closed) return;
            if (client.device === null) {
              // 인증 전 실패(기기 파일 읽기 등)는 토큰 문제가 아니다 — 다시 시도하게 하고, 내부 문구는 보내지 않는다.
              connection.send({ type: "error", code: "failed", message: "호스트가 잠시 응답하지 못했습니다" });
              connection.close(REMOTE_CLOSE.retry, "host error");
              return;
            }
            connection.send({ type: "error", code: "failed", message: errorText(error) });
          });
      },
      closed: () => {
        queue = queue.then(() => this.drop(client));
      },
    };
  }

  disconnectDevice(deviceId: string): void {
    for (const client of this.clients) {
      if (client.device?.deviceId !== deviceId) continue;
      // 닫힘 핸드셰이크를 기다리는 동안에도 입력이 통하면 안 된다 — 여기서 바로 끊어 둔다.
      client.closed = true;
      client.attached.clear();
      client.connection.close(REMOTE_CLOSE.revoked, "revoked");
    }
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    for (const client of this.clients) {
      clearTimeout(client.helloTimer);
      client.connection.close(1001, "host shutting down");
    }
    this.clients.clear();
  }

  private async handle(client: Client, raw: string): Promise<void> {
    if (client.closed) return;
    const message = parseRemoteClientMessage(raw);
    if (!message) {
      client.connection.send({ type: "error", code: "bad-message", message: "알 수 없는 메시지입니다" });
      return;
    }
    if (client.device === null) {
      await this.authenticate(client, message);
      return;
    }
    const deviceId = client.device.deviceId;
    switch (message.type) {
      case "hello":
        return;
      case "list":
        client.connection.send({ type: "sessions", sessions: await this.summaries() });
        return;
      case "attach": {
        // 먼저 붙여 두어야 attach가 도는 동안 나온 출력도 전달된다. 클라이언트가 sequence로 중복을 버린다.
        client.attached.add(message.sessionId);
        const result = await this.options.gateway.attach(message.sessionId);
        const size = this.options.sizes.current(message.sessionId);
        client.connection.send({
          type: "attached",
          sessionId: message.sessionId,
          replay: result.replay,
          sequence: result.sequence,
          cols: size.cols,
          rows: size.rows,
          sizeOwner: size.owner,
        });
        return;
      }
      case "detach":
        client.attached.delete(message.sessionId);
        await this.options.sizes.deviceRelease(deviceId, message.sessionId);
        return;
      case "write":
        if (!this.requireAttached(client, message.sessionId)) return;
        await this.options.gateway.write(message.sessionId, message.data);
        return;
      case "resize":
        if (!this.requireAttached(client, message.sessionId)) return;
        await this.options.sizes.deviceResize(deviceId, message.sessionId, message.cols, message.rows);
        return;
      case "releaseSize":
        await this.options.sizes.deviceRelease(deviceId, message.sessionId);
        return;
      case "catalog":
        client.connection.send({ type: "catalog", ...(await this.options.gateway.catalog()) });
        return;
      case "create": {
        // 만드는 화면이 어림한 크기로 시작한다(없으면 호스트 기본 크기). 크기는 호스트 것으로 적어
        // 둔다 — 붙은 뒤의 맞춤은 다른 세션과 같은 규칙을 따른다.
        const cols = clamp(message.cols ?? DEFAULT_TERMINAL_SIZE.cols, CREATE_COLS);
        const rows = clamp(message.rows ?? DEFAULT_TERMINAL_SIZE.rows, CREATE_ROWS);
        // 워크트리가 그 폴더 것인지는 코디네이터가 확인한다. 아니면 던지고, 거절 이유가 요청한 화면에 간다.
        const session = await this.options.gateway.create({
          projectId: message.projectId,
          kind: message.kind,
          ...(message.worktreeId !== undefined ? { worktreeId: message.worktreeId } : {}),
          cols,
          rows,
        });
        this.options.sizes.hostStarted(session.id, cols, rows);
        client.connection.send({ type: "started", sessionId: session.id });
        return;
      }
      case "stop":
        // 두 기기가 같은 세션을 보고 있으면 이미 끝난 세션에 중지가 올 수 있다.
        if (!this.isRunning(this.requireSession(message.sessionId))) throw new Error("이미 끝난 세션입니다");
        await this.options.gateway.stop(message.sessionId);
        return;
      case "resume": {
        // 돌고 있는 세션을 다시 시작하면 같은 대화에 프로세스가 둘 붙는다.
        if (this.isRunning(this.requireSession(message.sessionId))) throw new Error("이미 실행 중인 세션입니다");
        const last = this.options.sizes.current(message.sessionId);
        const cols = last.cols ?? DEFAULT_TERMINAL_SIZE.cols;
        const rows = last.rows ?? DEFAULT_TERMINAL_SIZE.rows;
        await this.options.gateway.resume({ sessionId: message.sessionId, cols, rows });
        if (last.cols === null || last.rows === null) this.options.sizes.hostStarted(message.sessionId, cols, rows);
        client.connection.send({ type: "started", sessionId: message.sessionId });
        return;
      }
      case "remove":
        await this.options.gateway.remove(message.sessionId);
        return;
    }
  }

  private requireSession(sessionId: string): TerminalSessionView {
    const session = this.options.gateway.list().find((candidate) => candidate.id === sessionId);
    if (!session) throw new Error("세션을 찾을 수 없습니다");
    return session;
  }

  private isRunning(session: TerminalSessionView): boolean {
    return session.pid !== null && session.status !== "exited" && session.status !== "error";
  }

  private async authenticate(client: Client, message: RemoteClientMessage): Promise<void> {
    if (message.type !== "hello") {
      client.connection.close(REMOTE_CLOSE.unauthorized, "hello required");
      return;
    }
    if (message.protocolVersion < REMOTE_MIN_PROTOCOL_VERSION || message.protocolVersion > REMOTE_PROTOCOL_VERSION) {
      client.connection.send({ type: "error", code: "protocol", message: "앱 버전이 호스트와 맞지 않습니다" });
      client.connection.close(REMOTE_CLOSE.protocol, "protocol mismatch");
      return;
    }
    const device = await this.options.devices.verify(message.token);
    if (!device) {
      client.connection.send({ type: "error", code: "unauthorized", message: "등록되지 않은 기기입니다" });
      client.connection.close(REMOTE_CLOSE.unauthorized, "unauthorized");
      return;
    }
    clearTimeout(client.helloTimer);
    client.device = device;
    void this.options.devices.touch(device.deviceId).catch(() => undefined);
    client.connection.send({
      type: "welcome",
      hostId: await this.options.hostId(),
      hostName: this.options.hostName,
      deviceId: device.deviceId,
      protocolVersion: REMOTE_PROTOCOL_VERSION,
      shellLatest: this.options.shellLatest?.() ?? null,
    });
    client.connection.send({ type: "sessions", sessions: await this.summaries() });
  }

  private requireAttached(client: Client, sessionId: string): boolean {
    if (client.attached.has(sessionId)) return true;
    client.connection.send({ type: "error", code: "not-attached", message: "세션에 먼저 연결하세요" });
    return false;
  }

  private async drop(client: Client): Promise<void> {
    clearTimeout(client.helloTimer);
    this.clients.delete(client);
    if (!client.device) return;
    for (const sessionId of client.attached) {
      await this.options.sizes.deviceRelease(client.device.deviceId, sessionId).catch(() => undefined);
    }
  }

  private async summaries(): Promise<RemoteSessionSummary[]> {
    const views = this.options.gateway.list();
    const names = new Map<string, string | null>();
    for (const projectId of new Set(views.map((view) => view.projectId))) {
      if (projectId !== null) names.set(projectId, await this.options.gateway.projectName(projectId));
    }
    const branches = new Map<string, string | null>();
    for (const worktreeId of new Set(views.map((view) => view.worktreeId))) {
      if (worktreeId) branches.set(worktreeId, await this.worktreeBranch(worktreeId));
    }
    return views.map((view) =>
      toSessionSummary(
        view,
        view.projectId === null ? null : names.get(view.projectId) ?? null,
        view.worktreeId ? branches.get(view.worktreeId) ?? null : null,
      ),
    );
  }

  private async worktreeBranch(worktreeId: string | null | undefined): Promise<string | null> {
    if (!worktreeId || !this.options.gateway.worktreeBranch) return null;
    return this.options.gateway.worktreeBranch(worktreeId).catch(() => null);
  }

  private authenticated(): Client[] {
    return [...this.clients].filter((client) => client.device !== null && !client.closed);
  }

  private forward(event: TerminalEvent): void {
    switch (event.type) {
      case "data":
        for (const client of this.authenticated()) {
          if (!client.attached.has(event.sessionId)) continue;
          if ((client.connection.bufferedAmount?.() ?? 0) > MAX_BUFFERED_BYTES) {
            client.closed = true;
            client.attached.clear();
            client.connection.close(REMOTE_CLOSE.retry, "slow consumer");
            continue;
          }
          client.connection.send({ type: "data", sessionId: event.sessionId, data: event.data, sequence: event.sequence });
        }
        return;
      case "status": {
        const presence = this.options.gateway.presence?.();
        this.broadcast({ type: "status", sessionId: event.sessionId, status: event.status, ...(presence ? { presence } : {}) });
        return;
      }
      case "title":
        this.broadcast({ type: "title", sessionId: event.sessionId, title: event.title });
        return;
      case "exit":
        this.broadcast({ type: "exit", sessionId: event.sessionId, exitCode: event.exitCode });
        return;
      case "removed":
        for (const client of this.clients) client.attached.delete(event.sessionId);
        this.options.sizes.forget(event.sessionId);
        this.broadcast({ type: "removed", sessionId: event.sessionId });
        return;
      case "created": {
        const projectId = event.session.projectId;
        void Promise.all([
          projectId === null ? Promise.resolve(null) : this.options.gateway.projectName(projectId),
          this.worktreeBranch(event.session.worktreeId),
        ])
          .then(([name, branch]) =>
            this.broadcast({ type: "created", session: toSessionSummary(event.session, name, branch) }),
          )
          .catch(() => undefined);
        return;
      }
      default:
        return;
    }
  }

  private broadcast(message: RemoteServerMessage): void {
    for (const client of this.authenticated()) client.connection.send(message);
  }

  private broadcastSize(sessionId: string, state: SizeState): void {
    if (state.cols === null || state.rows === null) return;
    for (const client of this.authenticated()) {
      if (client.attached.has(sessionId)) {
        client.connection.send({ type: "size", sessionId, cols: state.cols, rows: state.rows, sizeOwner: state.owner });
      }
    }
  }
}
