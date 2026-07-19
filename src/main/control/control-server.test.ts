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

async function start(options: { token?: string; pipeName?: string; handle?: (request: unknown) => Promise<never> }) {
  const pipeName = options.pipeName ?? `jk-coding-cli-test-${randomUUID()}`;
  const server = await startControlServer({
    pipeName,
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

describe("startControlServer", () => {
  it("round-trips one JSON line per connection for a valid token", async () => {
    const { server } = await start({});

    const response = JSON.parse(
      await request(server!.pipePath, `${JSON.stringify({ token: "secret", command: "list" })}\n`),
    );

    expect(response).toMatchObject({ ok: true, result: { echoed: { command: "list" } } });
  });

  it("rejects a wrong or missing token without reaching the handler", async () => {
    const handle = vi.fn();
    const { server } = await start({ handle: handle as never });

    const wrong = JSON.parse(await request(server!.pipePath, `${JSON.stringify({ token: "guess", command: "list" })}\n`));
    const missing = JSON.parse(await request(server!.pipePath, `${JSON.stringify({ command: "list" })}\n`));

    expect(wrong).toMatchObject({ ok: false, error: expect.stringContaining("인증 실패") });
    expect(missing).toMatchObject({ ok: false, error: expect.stringContaining("인증 실패") });
    expect(handle).not.toHaveBeenCalled();
  });

  it("answers malformed JSON with an error instead of crashing", async () => {
    const { server } = await start({});

    const response = JSON.parse(await request(server!.pipePath, "not json at all\n"));

    expect(response).toMatchObject({ ok: false, error: expect.stringContaining("JSON") });
  });

  it("yields null when the pipe name is already taken, leaving the first server alive", async () => {
    const { server: first, pipeName } = await start({});
    expect(first).not.toBeNull();

    const second = await startControlServer({
      pipeName,
      token: "other",
      handle: async () => ({ ok: true, result: null }),
      log: () => undefined,
    });

    expect(second).toBeNull();
    const response = JSON.parse(
      await request(first!.pipePath, `${JSON.stringify({ token: "secret", command: "list" })}\n`),
    );
    expect(response).toMatchObject({ ok: true });
  });
});
