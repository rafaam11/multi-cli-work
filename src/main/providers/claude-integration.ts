import fs from "node:fs/promises";
import path from "node:path";

const CLAUDE_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "Stop",
  "StopFailure",
] as const;

interface ClaudeHookHandler {
  type: "command";
  command: "powershell.exe";
  args: string[];
  timeout: 5;
}

export interface ClaudeSettingsOverlay {
  hooks: Record<(typeof CLAUDE_EVENTS)[number], Array<{ hooks: ClaudeHookHandler[] }>>;
}

export function buildClaudeSettings(hookPath: string): ClaudeSettingsOverlay {
  const handler: ClaudeHookHandler = {
    type: "command",
    command: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", hookPath],
    timeout: 5,
  };
  return {
    hooks: Object.fromEntries(
      CLAUDE_EVENTS.map((event) => [event, [{ hooks: [{ ...handler, args: [...handler.args] }] }]]),
    ) as ClaudeSettingsOverlay["hooks"],
  };
}

export const CLAUDE_STATUS_HOOK = String.raw`$ErrorActionPreference = "SilentlyContinue"
$sessionId = $env:MULTI_CLI_WORK_SESSION_ID
$statusDir = $env:MULTI_CLI_WORK_STATUS_DIR
if ([string]::IsNullOrWhiteSpace($sessionId) -or $sessionId -notmatch '^[a-zA-Z0-9-]+$') { exit 0 }
if ([string]::IsNullOrWhiteSpace($statusDir)) { exit 0 }

try { $inputValue = [Console]::In.ReadToEnd() | ConvertFrom-Json } catch { exit 0 }
$eventName = [string]$inputValue.hook_event_name
$status = switch ($eventName) {
  "SessionStart" { "idle"; break }
  "SessionEnd" { "exited"; break }
  "PermissionRequest" { "awaiting-approval"; break }
  "Stop" { "awaiting-input"; break }
  "StopFailure" { "awaiting-input"; break }
  "Notification" {
    $notificationType = [string]$inputValue.notification_type
    if ($notificationType -eq "permission_prompt") { "awaiting-approval" }
    elseif ($notificationType -in @("idle_prompt", "agent_needs_input", "agent_completed")) { "awaiting-input" }
    else { "idle" }
    break
  }
  default { "working" }
}

try {
  [IO.Directory]::CreateDirectory($statusDir) | Out-Null
  $target = Join-Path $statusDir ($sessionId + ".json")
  $temp = $target + "." + $PID + ".tmp"
  $payload = [ordered]@{ sessionId = $sessionId; status = $status; event = $eventName; at = [DateTime]::UtcNow.ToString("o") }
  [IO.File]::WriteAllText($temp, ($payload | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temp -Destination $target -Force
} catch { }
exit 0
`;

async function replaceFile(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tempPath, content, "utf8");
    await fs.rename(tempPath, filePath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

export async function ensureClaudeIntegration(userDataPath: string): Promise<{
  settingsPath: string;
  hookPath: string;
  statusDir: string;
}> {
  const hookDir = path.join(userDataPath, "hooks");
  const statusDir = path.join(userDataPath, "provider-status");
  const hookPath = path.join(hookDir, "claude-status.ps1");
  const settingsPath = path.join(userDataPath, "claude-settings.json");
  await Promise.all([fs.mkdir(hookDir, { recursive: true }), fs.mkdir(statusDir, { recursive: true })]);
  await replaceFile(hookPath, CLAUDE_STATUS_HOOK);
  await replaceFile(settingsPath, `${JSON.stringify(buildClaudeSettings(hookPath), null, 2)}\n`);
  return { settingsPath, hookPath, statusDir };
}
