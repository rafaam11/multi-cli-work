import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentDefinition, AgentId } from "../../shared/agent-types";
import type { ToolCommand } from "../../shared/terminal-types";

const execFileAsync = promisify(execFile);

export interface ProviderExecutables {
  /** Agent id → the executable found on PATH, or null when none of its commands resolved. */
  agents: Record<AgentId, string | null>;
  vscode: string | null;
}

export interface ProviderLaunchCommand {
  executable: string;
  args: string[];
  providerConversationId: string | null;
}

export function agentExecutable(executables: ProviderExecutables, agent: AgentDefinition): string {
  const resolved = executables.agents[agent.id];
  if (!resolved) throw new Error(`${agent.label} executable is not available`);
  return resolved;
}

function requireExecutable(value: string | null | undefined, label: string): string {
  if (!value) throw new Error(`${label} executable is not available`);
  return value;
}

const TOOL_SHELL_COMMANDS: Record<ToolCommand, string> = {
  "claude-update": "claude update",
  "codex-update": "codex update",
};

/**
 * Tool sessions run a CLI maintenance command inside PowerShell. `-NoExit` keeps the shell
 * alive so the output stays readable and interactive prompts can still be answered.
 */
export function buildToolLaunch(tool: ToolCommand, executables: ProviderExecutables): ProviderLaunchCommand {
  return {
    executable: requireExecutable(executables.agents.powershell, "PowerShell"),
    args: ["-NoLogo", "-NoExit", "-Command", TOOL_SHELL_COMMANDS[tool]],
    providerConversationId: null,
  };
}

/**
 * `where code` resolves to the `bin\code.cmd` shim on Windows, and Node refuses to spawn a
 * `.cmd` without a shell. The GUI executable sits one directory above the shim.
 */
export function vsCodeExecutableCandidate(cliPath: string): string | null {
  const normalized = cliPath.replaceAll("/", "\\").toLocaleLowerCase("en-US");
  if (!normalized.endsWith("\\bin\\code.cmd")) return null;
  return path.win32.resolve(path.win32.dirname(cliPath), "..", "Code.exe");
}

export interface EditorSpawnCommand {
  command: string;
  args: string[];
  shell: boolean;
  /**
   * `windowsHide` puts SW_HIDE in the child's STARTUPINFO, and a GUI app honours that for its own
   * first window — setting it on the editor executable launches VS Code with no window at all.
   * Only the cmd.exe wrapper, whose console we do want suppressed, may be hidden.
   */
  windowsHide: boolean;
}

export function buildEditorSpawn(cliPath: string, rootPath: string, resolvedExecutable: string | null): EditorSpawnCommand {
  if (resolvedExecutable) return { command: resolvedExecutable, args: [rootPath], shell: false, windowsHide: false };
  // Node does not escape arguments when `shell` is set, so quote them here. Windows paths cannot
  // contain a double quote, and `&`/`^` are inert inside a quoted cmd.exe token.
  if (/\.(cmd|bat)$/i.test(cliPath)) {
    return { command: `"${cliPath}"`, args: [`"${rootPath}"`], shell: true, windowsHide: true };
  }
  return { command: cliPath, args: [rootPath], shell: false, windowsHide: false };
}

export function pickWindowsExecutable(candidates: string[]): string | null {
  const usable = candidates.map((candidate) => candidate.trim()).filter(Boolean);
  return (
    usable.find((candidate) => candidate.toLocaleLowerCase("en-US").endsWith(".exe")) ??
    usable.find((candidate) => candidate.toLocaleLowerCase("en-US").endsWith(".cmd")) ??
    usable.find((candidate) => !candidate.toLocaleLowerCase("en-US").endsWith(".ps1")) ??
    null
  );
}

export async function findOnPath(command: string): Promise<string | null> {
  try {
    const locator = process.platform === "win32" ? "where.exe" : "which";
    const { stdout } = await execFileAsync(locator, [command], { windowsHide: true, timeout: 3_000 });
    const candidates = stdout.split(/\r?\n/).filter(Boolean);
    return process.platform === "win32" ? pickWindowsExecutable(candidates) : candidates[0] ?? null;
  } catch {
    return null;
  }
}

/** An agent names its executables in preference order, so PowerShell can ask for `pwsh` first. */
async function resolveAgent(agent: AgentDefinition): Promise<string | null> {
  for (const command of agent.commands) {
    const resolved = await findOnPath(command);
    if (resolved) return resolved;
  }
  return null;
}

export async function detectProviderExecutables(agents: readonly AgentDefinition[]): Promise<ProviderExecutables> {
  const [resolved, vscode] = await Promise.all([
    Promise.all(agents.map(async (agent) => [agent.id, await resolveAgent(agent)] as const)),
    findOnPath("code"),
  ]);
  return { agents: Object.fromEntries(resolved), vscode };
}
