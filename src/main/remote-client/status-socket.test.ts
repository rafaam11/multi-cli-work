// @vitest-environment node

import net from "node:net";
import { describe, expect, it } from "vitest";
import { createStatusSocket } from "./status-socket";

async function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

describe("createStatusSocket", () => {
  it("reports a host that is not listening as a close, not as a thrown error", async () => {
    // ws는 듣는 곳 없는 error를 예외로 던진다 — 꺼져 있는 호스트 하나가 앱을 죽이면 안 된다.
    const port = await closedPort();
    const socket = createStatusSocket(`ws://127.0.0.1:${port}/ws`);
    const code = await new Promise<number | undefined>((resolve) => {
      socket.onclose = (event: { code?: number }) => resolve(event.code);
    });
    expect(code).toBe(1006);
  });
});
