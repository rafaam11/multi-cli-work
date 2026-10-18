import net from "node:net";
import readline from "node:readline";
import { createMcpHandler } from "./control/jk-mcp-protocol";

/**
 * `jk-mcp.js`: the jk commands as an MCP server for Claude Code and Codex. The app copies the built
 * file to `userData/bin` and points each session's MCP config at it, run by the app's own executable
 * in node mode (`ELECTRON_RUN_AS_NODE`), so nothing has to be installed. It speaks to the app over
 * the same pipe and per-run token as the `jk` client.
 *
 * Kept free of imports from the rest of the main process, so the bundle stands alone.
 */

const env = process.env;
const token = env.JK_CODING_CLI_TOKEN ?? "";
const callerSessionId = env.MULTI_CLI_WORK_SESSION_ID ?? null;
const endpoint = env.JK_CODING_CLI_ENDPOINT ?? "";
const pipeName = env.JK_CODING_CLI_PIPE ?? "";

function connect(): net.Socket {
  if (endpoint.startsWith("tcp://127.0.0.1:")) return net.connect({ host: "127.0.0.1", port: Number(endpoint.slice("tcp://127.0.0.1:".length)) });
  const name = endpoint.startsWith("pipe://") ? endpoint.slice("pipe://".length) : pipeName;
  return net.connect(process.platform === "win32" ? `\\\\.\\pipe\\${name}` : name);
}

function call(command: string, args: Record<string, unknown>) {
  return new Promise<{ ok: true; result: unknown } | { ok: false; error: string }>((resolve) => {
    if (!token) {
      resolve({ ok: false, error: "jk: 멀티 터미널 작업기가 띄운 세션에서만 쓸 수 있습니다 (토큰 없음)." });
      return;
    }
    const socket = connect();
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({ token, callerSessionId, command, args })}\n`));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
    });
    socket.on("error", (error) => resolve({ ok: false, error: `jk: 앱에 연결할 수 없습니다 — ${error.message}` }));
    socket.on("close", () => {
      const line = buffer.split("\n")[0];
      if (!line) return resolve({ ok: false, error: "jk: 앱이 응답하지 않았습니다." });
      try {
        resolve(JSON.parse(line));
      } catch {
        resolve({ ok: false, error: `jk: 응답을 해석할 수 없습니다: ${line}` });
      }
    });
  });
}

const handle = createMcpHandler({
  call,
  write: (line) => process.stdout.write(`${line}\n`),
  version: env.MULTI_CLI_WORK_VERSION ?? "0",
});

const pending = new Set<Promise<void>>();
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  const task = handle(line).finally(() => pending.delete(task));
  pending.add(task);
});
// The client closing stdin is the shutdown signal; answers already on their way still go out.
input.on("close", () => {
  void Promise.allSettled([...pending]).then(() => process.exit(0));
});
