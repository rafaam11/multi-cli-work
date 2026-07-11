import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TerminalKind } from "../../shared/terminal-types";

const execFileAsync = promisify(execFile);

export interface ProviderExecutables {
  powershell: string | null;
  claude: string | null;
  codex: string | null;
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
      args: [...conversationArgs, "--settings", options.claudeSettingsPath],
      providerConversationId: conversationId,
    };
  }
  const conversationArgs = options.resumeConversationId ? ["resume", options.resumeConversationId] : [];
  return {
    executable: requireExecutable(options.executables.codex, "Codex"),
    args: [...conversationArgs, "-C", options.cwd, ...CODEX_NOTIFICATION_ARGS],
    providerConversationId: options.resumeConversationId ?? null,
  };
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
  const [pwsh, windowsPowerShell, claude, codex] = await Promise.all([
    findOnPath("pwsh"),
    findOnPath("powershell"),
    findOnPath("claude"),
    findOnPath("codex"),
  ]);
  return { powershell: pwsh ?? windowsPowerShell, claude, codex };
}
