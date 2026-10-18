// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_AGENTS } from "../agents/builtin-agents";
import { ensureControlCli } from "./control-cli-installer";
import { jkMcpLaunchArgs, removeJkMcpConfig } from "./jk-mcp-launch";
import { createMcpHandler, type ControlCall } from "./jk-mcp-protocol";
import { controlCallFor, JK_MCP_TOOLS } from "./jk-mcp-tools";

describe("jk MCP protocol", () => {
  function server(call = vi.fn<ControlCall>(async () => ({ ok: true as const, result: { sessionId: "s2", outcome: "held" } }))) {
    const out: unknown[] = [];
    const handle = createMcpHandler({ call, write: (line) => out.push(JSON.parse(line)), version: "1.49.0" });
    return { handle, out, call };
  }

  it("answers initialize with the client's protocol version and lists the tools", async () => {
    const { handle, out } = server();
    await handle(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }));
    await handle(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    await handle(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 1, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "jk", version: "1.49.0" } } });
    expect((out[1] as { result: { tools: Array<{ name: string }> } }).result.tools.map((tool) => tool.name)).toContain("board_post");
  });

  it("turns a tool call into a control command and its answer into text", async () => {
    const { handle, out, call } = server();
    await handle(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "jk_send", arguments: { sessionId: "s2", text: "hi" } } }));
    expect(call).toHaveBeenCalledWith("send", { sessionId: "s2", text: "hi" });
    expect(out[0]).toMatchObject({ id: 3, result: { content: [{ type: "text", text: expect.stringContaining('"outcome": "held"') }] } });
  });

  it("reports a refused command as a tool error, and an unknown tool or method as protocol errors", async () => {
    const { handle, out } = server(vi.fn(async () => ({ ok: false as const, error: "자기 자신에게는 보낼 수 없습니다." })));
    await handle(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "jk_send", arguments: {} } }));
    await handle(JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } }));
    await handle(JSON.stringify({ jsonrpc: "2.0", id: 6, method: "resources/list" }));
    await handle("{not json");
    expect(out).toEqual([
      { jsonrpc: "2.0", id: 4, result: { content: [{ type: "text", text: "자기 자신에게는 보낼 수 없습니다." }], isError: true } },
      { jsonrpc: "2.0", id: 5, error: { code: -32602, message: "Unknown tool: nope" } },
      { jsonrpc: "2.0", id: 6, error: { code: -32601, message: "Method not found: resources/list" } },
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
    ]);
  });
});

describe("jk MCP tools", () => {
  it("renames the arguments the control commands spell differently and drops nulls", () => {
    expect(controlCallFor("jk_spawn", { projectId: "p", agent: "codex", name: null })).toEqual({ command: "spawn", args: { projectId: "p", kind: "codex" } });
    expect(controlCallFor("board_read", { limit: 5 })).toEqual({ command: "board", args: { limit: 5 } });
    expect(controlCallFor("missing", {})).toBeNull();
  });

  it("describes every tool with a closed object schema", () => {
    for (const tool of JK_MCP_TOOLS) {
      expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });
});

describe("jk MCP launch", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "jk-mcp-"));
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  const options = () => ({
    executable: "C:\\Program Files\\Multi CLI Work\\Multi CLI Work.exe",
    scriptPath: "C:\\Users\\me\\AppData\\Roaming\\multi-cli-work\\bin\\jk-mcp.js",
    configDir: path.join(directory, "mcp"),
    environment: () => ({ JK_CODING_CLI_PIPE: "jk-coding-cli-1234", JK_CODING_CLI_TOKEN: "token" }),
    version: "1.49.0",
  });

  it("writes Claude a per-session MCP config with everything the server needs in its env", async () => {
    const args = await jkMcpLaunchArgs(BUILTIN_AGENTS.claude, "session-1", options());
    expect(args).toEqual(["--mcp-config", path.join(directory, "mcp", "session-1.json")]);
    const config = JSON.parse(await fs.readFile(args[1], "utf8"));
    expect(config.mcpServers.jk).toEqual({
      type: "stdio",
      command: options().executable,
      args: [options().scriptPath],
      env: {
        JK_CODING_CLI_PIPE: "jk-coding-cli-1234",
        JK_CODING_CLI_TOKEN: "token",
        ELECTRON_RUN_AS_NODE: "1",
        MULTI_CLI_WORK_SESSION_ID: "session-1",
        MULTI_CLI_WORK_VERSION: "1.49.0",
      },
    });
    await removeJkMcpConfig(options().configDir, "session-1");
    await expect(fs.access(args[1])).rejects.toThrow();
  });

  it("gives Codex TOML overrides with escaped Windows paths and a long tool timeout", async () => {
    const args = await jkMcpLaunchArgs(BUILTIN_AGENTS.codex, "session-2", options());
    expect(args).toEqual([
      "-c",
      'mcp_servers.jk.command="C:\\\\Program Files\\\\Multi CLI Work\\\\Multi CLI Work.exe"',
      "-c",
      'mcp_servers.jk.args=["C:\\\\Users\\\\me\\\\AppData\\\\Roaming\\\\multi-cli-work\\\\bin\\\\jk-mcp.js"]',
      "-c",
      'mcp_servers.jk.env={JK_CODING_CLI_PIPE="jk-coding-cli-1234", JK_CODING_CLI_TOKEN="token", ELECTRON_RUN_AS_NODE="1", MULTI_CLI_WORK_SESSION_ID="session-2", MULTI_CLI_WORK_VERSION="1.49.0"}',
      "-c",
      "mcp_servers.jk.tool_timeout_sec=1800",
    ]);
  });

  it("adds nothing for a shell or a user-defined agent", async () => {
    expect(await jkMcpLaunchArgs(BUILTIN_AGENTS.powershell, "s", options())).toEqual([]);
    expect(await jkMcpLaunchArgs({ ...BUILTIN_AGENTS.claude, builtin: false }, "s", options())).toEqual([]);
  });

  it("copies the server script into the bin directory, and survives a build without one", async () => {
    const source = path.join(directory, "jk-mcp.js");
    await fs.writeFile(source, "// server", "utf8");
    const installed = await ensureControlCli(path.join(directory, "user-data"), "win32", source);
    expect(installed.mcpScriptPath).toBe(path.join(directory, "user-data", "bin", "jk-mcp.js"));
    expect(await fs.readFile(installed.mcpScriptPath!, "utf8")).toBe("// server");

    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await ensureControlCli(path.join(directory, "other"), "win32", path.join(directory, "missing.js"))).mcpScriptPath).toBeNull();
    error.mockRestore();
  });
});
