import fs from "node:fs/promises";
import path from "node:path";
import type { AgentDefinition } from "../../shared/agent-types";

/**
 * How a built-in agent session is handed the jk MCP server. Nothing global is touched: Claude gets a
 * per-session `--mcp-config` file, Codex gets `-c mcp_servers.jk.*` overrides — the same way the app
 * already passes its status hooks.
 *
 * The server is spawned by the CLI, which may not pass its own environment on, so everything the
 * server needs travels in its explicit `env`: the pipe, the per-run token and the session's id.
 */

export interface JkMcpLaunchOptions {
  /** The app's executable, run in node mode. */
  executable: string;
  /** `userData/bin/jk-mcp.js`. */
  scriptPath: string;
  /** Where the per-session Claude configs are written. */
  configDir: string;
  environment(): Record<string, string>;
  version: string;
}

/** Codex's default tool timeout is a minute; `jk_wait` can block for up to half an hour. */
const TOOL_TIMEOUT_SECONDS = 1800;

function serverEnv(options: JkMcpLaunchOptions, sessionId: string): Record<string, string> {
  return {
    ...options.environment(),
    ELECTRON_RUN_AS_NODE: "1",
    MULTI_CLI_WORK_SESSION_ID: sessionId,
    MULTI_CLI_WORK_VERSION: options.version,
  };
}

/** A TOML basic string. JSON's escaping is a subset TOML accepts. */
const toml = (value: string) => JSON.stringify(value);

export async function jkMcpLaunchArgs(
  agent: AgentDefinition,
  sessionId: string,
  options: JkMcpLaunchOptions,
): Promise<string[]> {
  if (!agent.builtin) return [];
  const env = serverEnv(options, sessionId);
  if (agent.id === "claude") {
    const configPath = path.join(options.configDir, `${sessionId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
    await fs.mkdir(options.configDir, { recursive: true });
    const config = { mcpServers: { jk: { type: "stdio", command: options.executable, args: [options.scriptPath], env } } };
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    return ["--mcp-config", configPath];
  }
  if (agent.id === "codex") {
    const envTable = Object.entries(env)
      .map(([key, value]) => `${key}=${toml(value)}`)
      .join(", ");
    return [
      "-c",
      `mcp_servers.jk.command=${toml(options.executable)}`,
      "-c",
      `mcp_servers.jk.args=[${toml(options.scriptPath)}]`,
      "-c",
      `mcp_servers.jk.env={${envTable}}`,
      "-c",
      `mcp_servers.jk.tool_timeout_sec=${TOOL_TIMEOUT_SECONDS}`,
    ];
  }
  return [];
}

/** Drops the config of a session that is gone, and on start every config left from the last run. */
export async function removeJkMcpConfig(configDir: string, sessionId?: string): Promise<void> {
  if (sessionId) {
    await fs.rm(path.join(configDir, `${sessionId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`), { force: true });
    return;
  }
  await fs.rm(configDir, { recursive: true, force: true });
}
