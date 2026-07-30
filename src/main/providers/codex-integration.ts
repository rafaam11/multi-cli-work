import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const CODEX_APP_PROFILE = "multi-cli-work";

const HOOK_SCRIPT = `"use strict";
const fs = require("node:fs");
const path = require("node:path");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const sessionId = process.env.MULTI_CLI_WORK_SESSION_ID;
    const statusDir = process.env.MULTI_CLI_WORK_STATUS_DIR;
    if (!sessionId || !/^[a-zA-Z0-9-]+$/.test(sessionId) || !statusDir) process.exit(0);
    if (event.hook_event_name !== "SessionStart" || typeof event.session_id !== "string") process.exit(0);
    const target = path.join(statusDir, sessionId + ".json");
    const temporary = target + "." + process.pid + ".tmp";
    fs.mkdirSync(statusDir, { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify({
      sessionId,
      status: "working",
      event: "SessionStart",
      at: new Date().toISOString(),
      providerConversationId: event.session_id,
      ...(typeof event.transcript_path === "string" ? { transcriptPath: event.transcript_path } : {}),
    }) + "\\n", "utf8");
    fs.rmSync(target, { force: true });
    fs.renameSync(temporary, target);
  } catch { process.exitCode = 0; }
});
`;

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function shellLiteral(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function powershellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export interface CodexIntegrationOptions {
  userData: string;
  codexHome?: string;
  executablePath?: string;
}

export interface CodexIntegration {
  profileName: string;
  profilePath: string;
  hookScriptPath: string;
}

/** Installs a profile layer so only app-launched Codex sessions run the ownership hook. */
export async function ensureCodexIntegration(options: CodexIntegrationOptions): Promise<CodexIntegration> {
  const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  const executablePath = options.executablePath ?? process.execPath;
  const integrationDir = path.join(options.userData, "provider-hooks");
  const hookScriptPath = path.join(integrationDir, "codex-session-start.cjs");
  const profilePath = path.join(codexHome, `${CODEX_APP_PROFILE}.config.toml`);
  await fs.mkdir(integrationDir, { recursive: true });
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(hookScriptPath, HOOK_SCRIPT, "utf8");

  const command = `ELECTRON_RUN_AS_NODE=1 ${shellLiteral(executablePath)} ${shellLiteral(hookScriptPath)}`;
  const commandWindows = `$env:ELECTRON_RUN_AS_NODE='1'; & ${powershellLiteral(executablePath)} ${powershellLiteral(hookScriptPath)}`;
  const profile = `[features]\nhooks = true\n\n[[hooks.SessionStart]]\nmatcher = "^(startup|resume)$"\n\n[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = ${tomlString(command)}\ncommand_windows = ${tomlString(`powershell.exe -NoProfile -NonInteractive -Command "${commandWindows}"`)}\ntimeout = 5\n`;
  await fs.writeFile(profilePath, profile, "utf8");
  return { profileName: CODEX_APP_PROFILE, profilePath, hookScriptPath };
}
