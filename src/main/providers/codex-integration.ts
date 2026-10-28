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
function writeStatus(event) {
  const sessionId = process.env.MULTI_CLI_WORK_SESSION_ID;
  const statusDir = process.env.MULTI_CLI_WORK_STATUS_DIR;
  if (!sessionId || !/^[a-zA-Z0-9-]+$/.test(sessionId) || !statusDir) return;
  if (typeof event.session_id !== "string") return;
  const target = path.join(statusDir, sessionId + ".json");
  const temporary = target + "." + process.pid + "." + Date.now() + ".tmp";
  fs.mkdirSync(statusDir, { recursive: true });
  try {
  fs.writeFileSync(temporary, JSON.stringify({
    sessionId,
    status: ["Stop", "Interrupt"].includes(event.hook_event_name) ? "awaiting-input" : "working",
    event: event.hook_event_name,
    at: new Date().toISOString(),
    providerConversationId: event.session_id,
    provider: "codex",
    ...(typeof event.model === "string" ? { model: event.model } : {}),
    ...(typeof event.permission_mode === "string" ? { permissionMode: event.permission_mode } : {}),
    ...(typeof event.tool_name === "string" ? { toolName: event.tool_name } : {}),
    ...(process.env.MULTI_CLI_WORK_GENERATION ? { generation: process.env.MULTI_CLI_WORK_GENERATION } : {}),
    ...(typeof event.cwd === "string" && event.cwd ? { cwd: event.cwd } : {}),
    ...(typeof event.transcript_path === "string" ? { transcriptPath: event.transcript_path } : {}),
  }) + "\\n", "utf8");
  fs.rmSync(target, { force: true });
  fs.renameSync(temporary, target);
  } finally { fs.rmSync(temporary, { force: true }); }
}
// The work-project brief, in the same SessionStart shape the Claude hook prints. Non-ASCII goes out as
// \\uXXXX so the console code page cannot mangle Korean on the way to Codex.
function emitBrief() {
  const briefPath = process.env.MULTI_CLI_WORK_PROJECT_BRIEF;
  if (!briefPath) return;
  const brief = fs.readFileSync(briefPath, "utf8");
  if (!brief.trim()) return;
  const json = JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: brief } });
  process.stdout.write(json.replace(/[\\u007f-\\uffff]/g, (c) => "\\\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")));
}
// No process.exit: it can cut stdout short before Codex has read the brief.
process.stdin.on("end", () => {
  let event;
  try { event = JSON.parse(input); } catch { return; }
  if (!event || !["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "Interrupt"].includes(event.hook_event_name)) return;
  try { writeStatus(event); } catch {}
  if (event.hook_event_name === "SessionStart") { try { emitBrief(); } catch {} }
  if (["Stop", "Interrupt"].includes(event.hook_event_name)) process.stdout.write("{}");
});
`;

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function shellLiteral(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function batchQuotedPath(value: string): string {
  return `"${value.replaceAll("%", "%%")}"`;
}

function windowsHookRunner(executablePath: string, hookScriptPath: string): string {
  return [
    "@echo off",
    "setlocal DisableDelayedExpansion",
    'set "ELECTRON_RUN_AS_NODE=1"',
    `${batchQuotedPath(executablePath)} ${batchQuotedPath(hookScriptPath)}`,
    "exit /b %errorlevel%",
    "",
  ].join("\r\n");
}

async function readHookTrustState(profilePath: string): Promise<string> {
  try {
    const current = await fs.readFile(profilePath, "utf8");
    const match = /(?:^|\n)\[hooks\.state(?:\]|\.)/.exec(current);
    return match ? `\n${current.slice(match.index + (match[0].startsWith("\n") ? 1 : 0)).trimStart()}` : "";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
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
  const windowsHookRunnerPath = path.join(integrationDir, "codex-session-start.cmd");
  const profilePath = path.join(codexHome, `${CODEX_APP_PROFILE}.config.toml`);
  await fs.mkdir(integrationDir, { recursive: true });
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(hookScriptPath, HOOK_SCRIPT, "utf8");
  await fs.writeFile(windowsHookRunnerPath, windowsHookRunner(executablePath, hookScriptPath), "utf8");

  const command = `ELECTRON_RUN_AS_NODE=1 ${shellLiteral(executablePath)} ${shellLiteral(hookScriptPath)}`;
  const commandWindows = `cmd.exe /d /s /c ""${windowsHookRunnerPath.replaceAll("%", "%%")}""`;
  const trustState = await readHookTrustState(profilePath);
  const hook = (event: string, matcher = "") => `[[hooks.${event}]]\n${matcher}\n[[hooks.${event}.hooks]]\ntype = "command"\ncommand = ${tomlString(command)}\ncommand_windows = ${tomlString(commandWindows)}\ntimeout = ${event === "Interrupt" ? 3 : 5}\n`;
  const profile = `[features]\nhooks = true\n\n${hook("SessionStart", 'matcher = "^(startup|resume)$"')}\n${hook("UserPromptSubmit")}\n${hook("PreToolUse")}\n${hook("PostToolUse")}\n${hook("Stop")}\n${hook("Interrupt")}\n${trustState}`;
  await fs.writeFile(profilePath, profile, "utf8");
  return { profileName: CODEX_APP_PROFILE, profilePath, hookScriptPath };
}
