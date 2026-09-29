import type { TerminalAttachResult, TerminalSessionView } from "../../shared/api-types";
import type { TerminalEvent } from "../../shared/terminal-types";
import {
  parseRemoteClientMessage,
  REMOTE_CLOSE,
  REMOTE_PROTOCOL_VERSION,
  type RemoteClientMessage,
  type RemoteServerMessage,
  type RemoteSessionSummary,
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
}

export interface RemoteHubDevices {
  verify(token: string): Promise<RemoteDevice | null>;
  touch(deviceId: string): Promise<void>;
}

export interface RemoteConnection {
  send(message: RemoteServerMessage): void;
  close(code: number, reason: string): void;
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
}

interface Client {
  connection: RemoteConnection;
  device: RemoteDevice | null;
  attached: Set<string>;
  helloTimer: ReturnType<typeof setTimeout>;
}

export function toSessionSummary(view: TerminalSessionView, projectName: string | null): RemoteSessionSummary {
  return {
    id: view.id,
    projectId: view.projectId,
    projectName,
    kind: view.kind,
    label: view.name ?? view.title ?? view.kind,
    status: view.status,
    updatedAt: view.updatedAt,
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
      attached: new Set(),
      helloTimer: setTimeout(
        () => connection.close(REMOTE_CLOSE.unauthorized, "hello timeout"),
        this.options.helloTimeoutMs ?? 10_000,
      ),
    };
    this.clients.add(client);
    let queue = Promise.resolve();
    return {
      receive: (raw) => {
        queue = queue
          .then(() => this.handle(client, raw))
          .catch((error) => connection.send({ type: "error", code: "failed", message: errorText(error) }));
      },
      closed: () => {
        queue = queue.then(() => this.drop(client));
      },
    };
  }

  disconnectDevice(deviceId: string): void {
    for (const client of this.clients) {
      if (client.device?.deviceId === deviceId) client.connection.close(REMOTE_CLOSE.revoked, "revoked");
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
    }
  }

  private async authenticate(client: Client, message: RemoteClientMessage): Promise<void> {
    if (message.type !== "hello") {
      client.connection.close(REMOTE_CLOSE.unauthorized, "hello required");
      return;
    }
    if (message.protocolVersion !== REMOTE_PROTOCOL_VERSION) {
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
    return views.map((view) => toSessionSummary(view, view.projectId === null ? null : names.get(view.projectId) ?? null));
  }

  private authenticated(): Client[] {
    return [...this.clients].filter((client) => client.device !== null);
  }

  private forward(event: TerminalEvent): void {
    switch (event.type) {
      case "data":
        for (const client of this.authenticated()) {
          if (client.attached.has(event.sessionId)) {
            client.connection.send({ type: "data", sessionId: event.sessionId, data: event.data, sequence: event.sequence });
          }
        }
        return;
      case "status":
        this.broadcast({ type: "status", sessionId: event.sessionId, status: event.status });
        return;
      case "title":
        this.broadcast({ type: "title", sessionId: event.sessionId, title: event.title });
        return;
      case "exit":
        this.broadcast({ type: "exit", sessionId: event.sessionId, exitCode: event.exitCode });
        return;
      case "created": {
        const projectId = event.session.projectId;
        void (projectId === null ? Promise.resolve(null) : this.options.gateway.projectName(projectId))
          .then((name) => this.broadcast({ type: "created", session: toSessionSummary(event.session, name) }))
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
