import { StringDecoder } from "node:string_decoder";
import type { Readable, Writable } from "node:stream";
import {readTaskMcpConnection} from "./host/task-mcp-connection";

/** A per-agent stdio adapter. Its only authority is its task capability. */
export async function forwardTaskMcp(endpoint: string, token: string, request: unknown): Promise<unknown | null> {
  const url = new URL(endpoint);
  if (url.protocol !== "http:" || url.username || url.password || url.search || url.hash || url.pathname !== "/mcp" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid task MCP connection");
  const response = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(65000), headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(request) });
  if (!response.ok) throw new Error("Task MCP request rejected");
  return response.json();
}
export async function runTaskMcpClient(options: { endpoint: string; token: string; resolveConnection?:()=>Promise<{endpoint:string;token:string}>; input?: Readable; output?: Writable }): Promise<void> {
  const input: Readable = options.input ?? process.stdin; const output: Writable = options.output ?? process.stdout;
  const decoder = new StringDecoder("utf8"); let pending = "";
  const processLine = async (line: string) => {
    if (!line.trim()) return;
    let request: unknown;
    try { request = JSON.parse(line); } catch { output.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`); return; }
    try { const connection=options.resolveConnection?await options.resolveConnection():options; const response = await forwardTaskMcp(connection.endpoint, connection.token, request); if (response !== null) output.write(`${JSON.stringify(response)}\n`); }
    catch { const id = request && typeof request === "object" && "id" in request ? (request as { id: unknown }).id : undefined; if (id !== undefined) output.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: "Task host unavailable or capability rejected. A mutation may have committed; inspect the task before repeating it." } })}\n`); }
  };
  for await (const chunk of input) {
    pending += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (Buffer.byteLength(pending) > 262144) throw new Error("Task MCP input exceeds limit");
    let newline: number;
    while ((newline = pending.indexOf("\n")) !== -1) { const line = pending.slice(0, newline); pending = pending.slice(newline + 1); await processLine(line); }
  }
  pending += decoder.end(); if (pending.trim()) await processLine(pending);
}
if (process.argv.includes("--task-mcp-client")) {
  const resolveConnection=()=>readTaskMcpConnection(process.argv,process.env);
  void resolveConnection().then(connection=>runTaskMcpClient({...connection,resolveConnection})).catch(() => { process.stderr.write("Task MCP transport closed.\n"); process.exitCode = 1; });
}
