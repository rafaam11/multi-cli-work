import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import type { RemotePairResponse } from "../../shared/remote-types";
import type { RemoteSessionHub } from "./remote-session-hub";

export type PairOutcome = { ok: true; response: RemotePairResponse } | { ok: false; reason: "invalid" | "rate-limited" };

export interface RemoteServerOptions {
  host: string;
  port: number;
  /** out/renderer — mobile.html과 assets/가 있는 곳. */
  rendererDir: string;
  hub: Pick<RemoteSessionHub, "open">;
  pair(code: string, deviceName: string, clientIp: string): Promise<PairOutcome>;
  pingIntervalMs?: number;
}

export interface RunningRemoteServer {
  host: string;
  port: number;
  close(): Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};
const ASSET_NAME = /^[\w.-]+$/;
const MAX_PAIR_BODY_BYTES = 4_096;
const MAX_WS_PAYLOAD_BYTES = 1024 * 1024;

function send(response: http.ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "content-type": type,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(body);
}

async function serveFile(response: http.ServerResponse, filePath: string, cacheControl: string): Promise<boolean> {
  let body: Buffer;
  try {
    body = await fs.readFile(filePath);
  } catch {
    return false;
  }
  response.writeHead(200, {
    "content-type": CONTENT_TYPES[path.extname(filePath)] ?? "application/octet-stream",
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(body);
  return true;
}

function readBody(request: http.IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_PAIR_BODY_BYTES) {
        resolve(null);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", () => resolve(null));
  });
}

function clientIp(request: http.IncomingMessage): string {
  return (request.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
}

async function handlePair(options: RemoteServerOptions, request: http.IncomingMessage, response: http.ServerResponse) {
  const body = await readBody(request);
  let parsed: unknown;
  try {
    parsed = body === null ? null : JSON.parse(body);
  } catch {
    parsed = null;
  }
  const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  if (!record || typeof record.code !== "string" || typeof record.deviceName !== "string") {
    send(response, 400, "잘못된 요청입니다");
    return;
  }
  const outcome = await options.pair(record.code, record.deviceName, clientIp(request));
  if (outcome.ok) send(response, 200, JSON.stringify(outcome.response), CONTENT_TYPES[".json"]);
  else if (outcome.reason === "rate-limited") send(response, 429, "시도가 너무 많습니다");
  else send(response, 401, "코드가 맞지 않거나 만료되었습니다");
}

async function handleRequest(options: RemoteServerOptions, request: http.IncomingMessage, response: http.ServerResponse) {
  const url = new URL(request.url ?? "/", "http://host");
  const pathname = url.pathname;
  if (request.method === "POST" && pathname === "/pair") return handlePair(options, request, response);
  if (request.method !== "GET") return send(response, 405, "허용되지 않는 요청입니다");
  if (pathname === "/") {
    response.writeHead(302, { location: "/mobile/" });
    response.end();
    return;
  }
  if (pathname === "/mobile" || pathname === "/mobile/") {
    const served = await serveFile(response, path.join(options.rendererDir, "mobile.html"), "no-cache");
    if (!served) send(response, 503, "모바일 화면 번들이 없습니다. 호스트에서 npm run build를 먼저 실행하세요.");
    return;
  }
  const assetPrefix = "/mobile/assets/";
  if (pathname.startsWith(assetPrefix)) {
    const name = decodeURIComponent(pathname.slice(assetPrefix.length));
    if (ASSET_NAME.test(name) && !name.startsWith(".")) {
      const served = await serveFile(response, path.join(options.rendererDir, "assets", name), "public, max-age=31536000, immutable");
      if (served) return;
    }
  }
  send(response, 404, "없는 경로입니다");
}

function rejectUpgrade(socket: import("node:stream").Duplex, status: number, text: string) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/**
 * 모바일 컴패니언용 HTTP + WS 서버. 무엇에 bind할지(Tailscale 주소)는 remote-access.ts가 정하고,
 * 이 파일은 받은 주소에만 listen한다.
 */
export async function startRemoteServer(options: RemoteServerOptions): Promise<RunningRemoteServer> {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD_BYTES });
  const alive = new WeakMap<WebSocket, boolean>();

  const server = http.createServer((request, response) => {
    handleRequest(options, request, response).catch(() => {
      if (!response.headersSent) send(response, 500, "서버 오류");
      else response.end();
    });
  });

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://host").pathname;
    if (pathname !== "/ws") return rejectUpgrade(socket, 404, "Not Found");
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== `http://${request.headers.host}`) {
      return rejectUpgrade(socket, 403, "Forbidden");
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      alive.set(ws, true);
      ws.on("pong", () => alive.set(ws, true));
      const handle = options.hub.open({
        send: (message) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
        },
        close: (code, reason) => ws.close(code, reason),
      });
      ws.on("message", (data, isBinary) => {
        if (isBinary) ws.close(1003, "text only");
        else handle.receive(data.toString());
      });
      ws.on("close", () => handle.closed());
    });
  });

  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, options.pingIntervalMs ?? 30_000);
  ping.unref();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;

  return {
    host: options.host,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(ping);
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
