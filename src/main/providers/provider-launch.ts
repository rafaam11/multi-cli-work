import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { TerminalKind, ToolCommand } from "../../shared/terminal-types";

const execFileAsync = promisify(execFile);

export interface ProviderExecutables {
  powershell: string | null;
  claude: string | null;
  codex: string | null;
  vscode: string | null;
}

interface ProviderLaunchOptions {
  cwd: string;
  appSessionId: string;
  claudeSettingsPath: string;
  executables: ProviderExecutables;
  resumeConversationId?: string | null;
}

export interface ProviderLaunchCommand {
  executable: string;
  args: string[];
  providerConversationId: string | null;
}

function requireExecutable(value: string | null, label: string): string {
  if (!value) throw new Error(`${label} executable is not available`);
  return value;
}

const CODEX_NOTIFICATION_ARGS = [
  "-c",
  'tui.notifications=["agent-turn-complete","approval-requested"]',
  "-c",
  'tui.notification_method="osc9"',
  "-c",
  'tui.notification_condition="always"',
];

const TOOL_SHELL_COMMANDS: Record<ToolCommand, string> = {
  "claude-update": "claude update",
  "codex-update": "codex update",
};

export function buildProviderLaunch(kind: TerminalKind, options: ProviderLaunchOptions): ProviderLaunchCommand {
  if (kind === "powershell") {
    return {
      executable: requireExecutable(options.executables.powershell, "PowerShell"),
      args: ["-NoLogo"],
      providerConversationId: null,
    };
  }
  if (kind === "claude") {
    const conversationId = options.resumeConversationId ?? options.appSessionId;
    const conversationArgs = options.resumeConversationId
      ? ["--resume", options.resumeConversationId]
      : ["--session-id", options.appSessionId];
    return {
      executable: requireExecutable(options.executables.claude, "Claude"),
      args: [
        ...conversationArgs,
        "--settings",
        options.claudeSettingsPath,
        "--dangerously-skip-permissions",
      ],
      providerConversationId: conversationId,
    };
  }
  const conversationArgs = options.resumeConversationId ? ["resume", options.resumeConversationId] : [];
  return {
    executable: requireExecutable(options.executables.codex, "Codex"),
    args: [
      ...conversationArgs,
      "-C",
      options.cwd,
      "--dangerously-bypass-approvals-and-sandbox",
      ...CODEX_NOTIFICATION_ARGS,
    ],
    providerConversationId: options.resumeConversationId ?? null,
  };
}

/**
 * Tool sessions run a CLI maintenance command inside PowerShell. `-NoExit` keeps the shell
 * alive so the output stays readable and interactive prompts can still be answered.
 */
export function buildToolLaunch(tool: ToolCommand, executables: ProviderExecutables): ProviderLaunchCommand {
  return {
    executable: requireExecutable(executables.powershell, "PowerShell"),
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

async function findOnPath(command: string): Promise<string | null> {
  try {
    const locator = process.platform === "win32" ? "where.exe" : "which";
    const { stdout } = await execFileAsync(locator, [command], { windowsHide: true, timeout: 3_000 });
    const candidates = stdout.split(/\r?\n/).filter(Boolean);
    return process.platform === "win32" ? pickWindowsExecutable(candidates) : candidates[0] ?? null;
  } catch {
    return null;
  }
}

export async function detectProviderExecutables(): Promise<ProviderExecutables> {
  const [pwsh, windowsPowerShell, claude, codex, vscode] = await Promise.all([
    findOnPath("pwsh"),
    findOnPath("powershell"),
    findOnPath("claude"),
    findOnPath("codex"),
    findOnPath("code"),
  ]);
  return { powershell: pwsh ?? windowsPowerShell, claude, codex, vscode };
}
