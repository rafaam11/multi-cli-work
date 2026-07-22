import { timingSafeEqual } from "node:crypto";
import net from "node:net";
import type { ControlRequest, ControlResponse } from "./control-commands";

/**
 * The named-pipe end of jk-coding-cli: one JSON line in, one JSON line out, one request per
 * connection. The pipe's OS ACL already limits it to the same user; the per-run token narrows that
 * further to processes the app itself spawned.
 */

const MAX_REQUEST_BYTES = 1024 * 1024;

export interface ControlServerOptions {
  pipeName: string;
  platform?: NodeJS.Platform;
  token: string;
  handle(request: ControlRequest): Promise<ControlResponse>;
  log?(message: string, error: unknown): void;
}

export interface ControlServer {
  endpoint: string;
  /** Kept for the v1.5 Windows client and existing integrations. */
  pipePath: string;
  close(): void;
}

function tokenMatches(expected: string, received: unknown): boolean {
  if (typeof received !== "string") return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}

/**
 * Resolves to null when the pipe name is already taken — a second app instance, or a dev build next
 * to an installed one. The app keeps running; only the CLI is unavailable in that copy.
 */
export function startControlServer(options: ControlServerOptions): Promise<ControlServer | null> {
  const platform = options.platform ?? process.platform;
  const pipePath = platform === "win32" ? `\\\\.\\pipe\\${options.pipeName}` : "";
  return new Promise((resolve) => {
    let listening = false;
    const server = net.createServer((socket) => {
      let buffer = "";
      let handled = false;
      socket.setEncoding("utf8");
      socket.on("error", () => undefined);
      const respond = (response: ControlResponse) => {
        socket.end(`${JSON.stringify(response)}\n`);
      };
      socket.on("data", (chunk: string) => {
        if (handled) return;
        buffer += chunk;
        if (Buffer.byteLength(buffer) > MAX_REQUEST_BYTES) {
          handled = true;
          respond({ ok: false, error: "요청이 너무 큽니다." });
          return;
        }
        const newline = buffer.indexOf("\n");
        if (newline === -1) return;
        handled = true;
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        void (async () => {
          let request: ControlRequest;
          try {
            request = JSON.parse(line) as ControlRequest;
          } catch {
            respond({ ok: false, error: "요청 JSON을 해석할 수 없습니다." });
            return;
          }
          if (!isRequestShape(request)) {
            respond({ ok: false, error: "요청 형식이 올바르지 않습니다." });
            return;
          }
          if (!tokenMatches(options.token, request.token)) {
            respond({ ok: false, error: "인증 실패: 이 앱 인스턴스가 발급한 토큰이 아닙니다." });
            return;
          }
          try {
            respond(await options.handle(request));
          } catch (error) {
            respond({ ok: false, error: error instanceof Error ? error.message : String(error) });
          }
        })();
      });
    });
    server.on("error", (error) => {
      options.log?.("jk-coding-cli control server unavailable", error);
      if (!listening) resolve(null);
    });
    const onListening = () => {
      listening = true;
      const address = server.address();
      const endpoint =
        typeof address === "object" && address !== null
          ? `tcp://127.0.0.1:${address.port}`
          : `pipe://${options.pipeName}`;
      resolve({ endpoint, pipePath: platform === "win32" ? pipePath : endpoint, close: () => server.close() });
    };
    if (platform === "win32") server.listen(pipePath, onListening);
    else server.listen({ host: "127.0.0.1", port: 0 }, onListening);
  });
}

function isRequestShape(value: unknown): value is ControlRequest {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
