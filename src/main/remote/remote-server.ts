import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { RemotePairResponse } from "../../shared/remote-types";
import type { RemoteSessionHub } from "./remote-session-hub";
import type { ShellArtifact } from "./shell-artifact";

export type PairOutcome = { ok: true; response: RemotePairResponse } | { ok: false; reason: "invalid" | "rate-limited" };

export interface RemoteServerOptions {
  host: string;
  port: number;
  /** out/renderer — mobile.html과 assets/가 있는 곳. */
  rendererDir: string;
  hub: Pick<RemoteSessionHub, "open">;
  pair(code: string, deviceName: string, clientIp: string): Promise<PairOutcome>;
  pingIntervalMs?: number;
  shell?: ShellArtifact | null;
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
const CLOSE_GRACE_MS = 2_000;

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

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** 폰 브라우저가 처음 한 번 여는 페이지. 스크립트 없이 링크와 안내만 있다. */
function installPage(shell: ShellArtifact | null): string {
  const body = shell
    ? `<p><a class="button" href="/shell.apk">모바일 앱 받기 (v${escapeHtml(shell.release.versionName)})</a></p>
<ol>
<li>받은 파일을 열고, "이 출처의 앱 설치 허용"을 켠 뒤 설치합니다.</li>
<li>앱에서 <b>QR로 PC 추가</b>를 누르고 PC의 설정 ▸ 모바일 ▸ 기기 추가 QR을 찍습니다.</li>
<li>이후 업데이트는 앱이 PC에서 직접 받아 설치합니다.</li>
</ol>`
    : "<p>이 PC 설치본에는 모바일 앱이 들어 있지 않습니다. 릴리스 설치본을 쓰거나 개발 빌드에서 build/mobile을 준비하세요.</p>";
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>멀티 터미널 작업기 모바일 설치</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#101214;color:#e6e6e6;margin:0;padding:24px}a.button{display:inline-block;padding:12px 16px;border-radius:8px;background:#4c8dff;color:#fff;text-decoration:none}</style>
</head><body><h1>모바일 앱 설치</h1>${body}</body></html>`;
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
  if (pathname === "/shell.json") {
    if (!options.shell) return send(response, 404, "동봉된 모바일 앱이 없습니다");
    return send(response, 200, JSON.stringify(options.shell.release), CONTENT_TYPES[".json"]);
  }
  if (pathname === "/shell.apk") {
    if (!options.shell) return send(response, 404, "동봉된 모바일 앱이 없습니다");
    const stat = await fs.stat(options.shell.apkPath).catch(() => null);
    if (!stat) return send(response, 404, "동봉된 모바일 앱이 없습니다");
    response.writeHead(200, {
      "content-type": "application/vnd.android.package-archive",
      "content-length": String(stat.size),
      "content-disposition": `attachment; filename="Multi-CLI-Work-Mobile-${options.shell.release.versionName}.apk"`,
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
    });
    pipeline(createReadStream(options.shell.apkPath), response, (error) => {
      if (error) response.destroy();
    });
    return;
  }
  if (pathname === "/install") return send(response, 200, installPage(options.shell ?? null), CONTENT_TYPES[".html"]);
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
        close: (code, reason) => {
          ws.close(code, reason);
          // 상대가 닫힘 핸드셰이크에 답하지 않아도 오래 붙잡지 않는다.
          setTimeout(() => ws.terminate(), CLOSE_GRACE_MS).unref();
        },
        bufferedAmount: () => ws.bufferedAmount,
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
