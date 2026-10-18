import { controlCallFor, JK_MCP_INSTRUCTIONS, JK_MCP_TOOLS } from "./jk-mcp-tools";

/**
 * A minimal MCP server over newline-delimited JSON-RPC: `initialize`, `tools/list`, `tools/call`,
 * `ping`. That is all a tool-only server needs, and it keeps the SDK (and its dependencies) out of a
 * script that has to run on its own from `userData/bin`.
 */

const FALLBACK_PROTOCOL_VERSION = "2025-06-18";

export type ControlCall = (command: string, args: Record<string, unknown>) => Promise<{ ok: true; result: unknown } | { ok: false; error: string }>;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface McpServerOptions {
  call: ControlCall;
  write(line: string): void;
  version: string;
}

export function createMcpHandler(options: McpServerOptions): (line: string) => Promise<void> {
  const reply = (id: JsonRpcRequest["id"], result: unknown) =>
    options.write(JSON.stringify({ jsonrpc: "2.0", id, result }));
  const fail = (id: JsonRpcRequest["id"], code: number, message: string) =>
    options.write(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }));

  return async (line: string) => {
    if (!line.trim()) return;
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
    } catch {
      fail(null, -32700, "Parse error");
      return;
    }
    const isNotification = request.id === undefined;
    switch (request.method) {
      case "initialize":
        reply(request.id, {
          protocolVersion: typeof request.params?.protocolVersion === "string" ? request.params.protocolVersion : FALLBACK_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "jk", version: options.version },
          instructions: JK_MCP_INSTRUCTIONS,
        });
        return;
      case "ping":
        reply(request.id, {});
        return;
      case "tools/list":
        reply(request.id, { tools: JK_MCP_TOOLS });
        return;
      case "tools/call": {
        const name = typeof request.params?.name === "string" ? request.params.name : "";
        const rawArgs = request.params?.arguments;
        const args = typeof rawArgs === "object" && rawArgs !== null && !Array.isArray(rawArgs) ? (rawArgs as Record<string, unknown>) : {};
        const call = controlCallFor(name, args);
        if (!call) {
          fail(request.id, -32602, `Unknown tool: ${name}`);
          return;
        }
        let text: string;
        let isError = false;
        try {
          const response = await options.call(call.command, call.args);
          if (response.ok) text = JSON.stringify(response.result, null, 2);
          else {
            text = response.error;
            isError = true;
          }
        } catch (error) {
          text = error instanceof Error ? error.message : String(error);
          isError = true;
        }
        reply(request.id, { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });
        return;
      }
      default:
        // Notifications (initialized, cancelled, …) need no answer; an unknown request does.
        if (!isNotification) fail(request.id, -32601, `Method not found: ${request.method ?? ""}`);
    }
  };
}
