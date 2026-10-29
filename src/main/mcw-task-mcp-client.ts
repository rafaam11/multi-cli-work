import { StringDecoder } from "node:string_decoder";
import type { Readable, Writable } from "node:stream";

/** A per-agent stdio adapter. Its only authority is the task capability supplied in its environment. */
export async function forwardTaskMcp(endpoint: string, token: string, request: unknown): Promise<unknown | null> {
  const url = new URL(endpoint);
  if (url.protocol !== "http:" || url.username || url.password || url.search || url.hash || url.pathname !== "/mcp" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid task MCP connection");
  const response = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(65000), headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(request) });
  if (!response.ok) throw new Error("Task MCP request rejected");
  return response.json();
}
export async function runTaskMcpClient(options: { endpoint: string; token: string; input?: Readable; output?: Writable }): Promise<void> {
  const input: Readable = options.input ?? process.stdin; const output: Writable = options.output ?? process.stdout;
  const decoder = new StringDecoder("utf8"); let pending = "";
  const processLine = async (line: string) => {
    if (!line.trim()) return;
    let request: unknown;
    try { request = JSON.parse(line); } catch { output.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`); return; }
    try { const response = await forwardTaskMcp(options.endpoint, options.token, request); if (response !== null) output.write(`${JSON.stringify(response)}\n`); }
    catch { const id = request && typeof request === "object" && "id" in request ? (request as { id: unknown }).id : undefined; if (id !== undefined) output.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: "Task host unavailable or capability rejected" } })}\n`); }
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
  void runTaskMcpClient({ endpoint: process.env.MCW_TASK_URL ?? "", token: process.env.MCW_TASK_TOKEN ?? "" }).catch(() => { process.stderr.write("Task MCP transport closed.\n"); process.exitCode = 1; });
}
