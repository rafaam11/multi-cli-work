// @vitest-environment node

import { randomUUID } from "node:crypto";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlServer } from "./control-server";
import { startControlServer } from "./control-server";

const servers: ControlServer[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function start(options: {
  token?: string;
  pipeName?: string;
  platform?: NodeJS.Platform;
  handle?: (request: unknown) => Promise<never>;
}) {
  const pipeName = options.pipeName ?? `jk-coding-cli-test-${randomUUID()}`;
  const server = await startControlServer({
    pipeName,
    platform: options.platform ?? "linux",
    token: options.token ?? "secret",
    handle: (options.handle as never) ?? (async (request: unknown) => ({ ok: true, result: { echoed: request } }) as never),
  });
  if (server) servers.push(server);
  return { server, pipeName };
}

function request(pipePath: string, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipePath, () => {
      socket.write(line);
    });
    let received = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      received += chunk;
    });
    socket.on("end", () => resolve(received.trim()));
    socket.on("error", reject);
  });
}

function serverRequest(server: ControlServer, line: string): Promise<string> {
  if (server.endpoint.startsWith("tcp://")) return tcpRequest(Number(new URL(server.endpoint).port), line);
  return request(server.pipePath, line);
}

function tcpRequest(port: number, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => socket.write(line));
    let received = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => (received += chunk));
    socket.on("end", () => resolve(received.trim()));
    socket.on("error", reject);
  });
}

describe("startControlServer", () => {
  it("uses an ephemeral loopback TCP endpoint on Linux", async () => {
    const server = await startControlServer({
      platform: "linux",
      pipeName: "unused",
      token: "secret",
      handle: async () => ({ ok: true, result: "ok" }),
    });
    servers.push(server!);

    expect(server?.endpoint).toMatch(/^tcp:\/\/127\.0\.0\.1:\d+$/);
    const port = Number(new URL(server!.endpoint).port);
    await expect(tcpRequest(port, '{"token":"secret","command":"list"}\n')).resolves.toContain('"ok":true');
  });
  it("round-trips one JSON line per connection for a valid token", async () => {
    const { server } = await start({});

    const response = JSON.parse(
      await serverRequest(server!, `${JSON.stringify({ token: "secret", command: "list" })}\n`),
    );

    expect(response).toMatchObject({ ok: true, result: { echoed: { command: "list" } } });
  });

  it("rejects a wrong or missing token without reaching the handler", async () => {
    const handle = vi.fn();
    const { server } = await start({ handle: handle as never });

    const wrong = JSON.parse(await serverRequest(server!, `${JSON.stringify({ token: "guess", command: "list" })}\n`));
    const missing = JSON.parse(await serverRequest(server!, `${JSON.stringify({ command: "list" })}\n`));

    expect(wrong).toMatchObject({ ok: false, error: expect.stringContaining("인증 실패") });
    expect(missing).toMatchObject({ ok: false, error: expect.stringContaining("인증 실패") });
    expect(handle).not.toHaveBeenCalled();
  });

  it("answers malformed JSON with an error instead of crashing", async () => {
    const { server } = await start({});

    const response = JSON.parse(await serverRequest(server!, "not json at all\n"));

    expect(response).toMatchObject({ ok: false, error: expect.stringContaining("JSON") });
  });

  it("yields null when the pipe name is already taken, leaving the first server alive", async () => {
    if (process.platform !== "win32") return;
    const { server: first, pipeName } = await start({ platform: "win32" });
    expect(first).not.toBeNull();

    const second = await startControlServer({
      pipeName,
      platform: "win32",
      token: "other",
      handle: async () => ({ ok: true, result: null }),
      log: () => undefined,
    });

    expect(second).toBeNull();
    const response = JSON.parse(
      await serverRequest(first!, `${JSON.stringify({ token: "secret", command: "list" })}\n`),
    );
    expect(response).toMatchObject({ ok: true });
  });
});
