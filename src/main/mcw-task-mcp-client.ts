import { StringDecoder } from "node:string_decoder";
import type { Readable, Writable } from "node:stream";
import { lstat, open } from "node:fs/promises";
import path from "node:path";

/** A per-agent stdio adapter. Its only authority is its task capability. */
export async function forwardTaskMcp(endpoint: string, token: string, request: unknown): Promise<unknown | null> {
  const url = new URL(endpoint);
  if (url.protocol !== "http:" || url.username || url.password || url.search || url.hash || url.pathname !== "/mcp" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid task MCP connection");
  const response = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(65000), headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(request) });
  if (!response.ok) throw new Error("Task MCP request rejected");
  return response.json();
}
export async function readTaskMcpConnection(args: string[], env: NodeJS.ProcessEnv): Promise<{endpoint:string;token:string}> {
  const index=args.indexOf("--connection-file");
  // Existing running previews can keep their per-client environment until exit.
  if(index===-1)return {endpoint:env.MCW_TASK_URL??"",token:env.MCW_TASK_TOKEN??""};
  const file=args[index+1];
  if(!file||!path.isAbsolute(file)||args.lastIndexOf("--connection-file")!==index)throw new Error("Invalid task MCP connection file");
  const before=await lstat(file);
  if(!before.isFile()||before.isSymbolicLink()||before.size>16384)throw new Error("Invalid task MCP connection file");
  const handle=await open(file,"r");
  try{
    const stat=await handle.stat();
    // Windows path stats may report dev=0 while handle stats report the volume.
    if(!stat.isFile()||(before.dev!==0&&stat.dev!==before.dev)||stat.ino!==before.ino||stat.size>16384)throw new Error("Task MCP connection file changed");
    const value:unknown=JSON.parse(await handle.readFile("utf8"));
    if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(key=>!["endpoint","token"].includes(key)))throw new Error("Invalid task MCP connection file");
    const record=value as Record<string,unknown>;
    if(typeof record.endpoint!=="string"||typeof record.token!=="string")throw new Error("Invalid task MCP connection file");
    return {endpoint:record.endpoint,token:record.token};
  }finally{await handle.close();}
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
