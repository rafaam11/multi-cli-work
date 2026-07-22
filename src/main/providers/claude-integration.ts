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
  command: string;
  args: string[];
  timeout: 10;
}

export interface ClaudeSettingsOverlay {
  hooks: Record<(typeof CLAUDE_EVENTS)[number], Array<{ hooks: ClaudeHookHandler[] }>>;
}

export function buildClaudeSettings(
  hookPath: string,
  platform: NodeJS.Platform = process.platform,
): ClaudeSettingsOverlay {
  const handler: ClaudeHookHandler = platform === "win32"
    ? {
        type: "command",
        command: "powershell.exe",
        args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", hookPath],
        timeout: 10,
      }
    : { type: "command", command: "python3", args: [hookPath], timeout: 10 };
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
    elseif ($notificationType -in @("idle_prompt", "agent_needs_input", "agent_completed", "elicitation_dialog")) { "awaiting-input" }
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

export const CLAUDE_STATUS_HOOK_PYTHON = String.raw`#!/usr/bin/env python3
import datetime, json, os, re, sys, tempfile
session_id = os.environ.get("MULTI_CLI_WORK_SESSION_ID", "")
status_dir = os.environ.get("MULTI_CLI_WORK_STATUS_DIR", "")
if not re.fullmatch(r"[a-zA-Z0-9-]+", session_id) or not status_dir: raise SystemExit(0)
try: value = json.load(sys.stdin)
except Exception: raise SystemExit(0)
event = str(value.get("hook_event_name", ""))
if event == "SessionStart": status = "idle"
elif event == "SessionEnd": status = "exited"
elif event == "PermissionRequest": status = "awaiting-approval"
elif event in ("Stop", "StopFailure"): status = "awaiting-input"
elif event == "Notification":
    notification = str(value.get("notification_type", ""))
    if notification == "permission_prompt": status = "awaiting-approval"
    elif notification in ("idle_prompt", "agent_needs_input", "agent_completed", "elicitation_dialog"): status = "awaiting-input"
    else: status = "idle"
else: status = "working"
try:
    os.makedirs(status_dir, exist_ok=True)
    target = os.path.join(status_dir, session_id + ".json")
    payload = dict(sessionId=session_id, status=status, event=event, at=datetime.datetime.now(datetime.timezone.utc).isoformat())
    fd, temporary = tempfile.mkstemp(prefix=session_id + ".", suffix=".tmp", dir=status_dir)
    with os.fdopen(fd, "w", encoding="utf-8") as output: json.dump(payload, output, separators=(",", ":"))
    os.replace(temporary, target)
except Exception: pass
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

export async function ensureClaudeIntegration(
  userDataPath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<{
  settingsPath: string;
  hookPath: string;
  statusDir: string;
}> {
  const hookDir = path.join(userDataPath, "hooks");
  const statusDir = path.join(userDataPath, "provider-status");
  const hookPath = path.join(hookDir, platform === "win32" ? "claude-status.ps1" : "claude-status.py");
  const settingsPath = path.join(userDataPath, "claude-settings.json");
  await Promise.all([fs.mkdir(hookDir, { recursive: true }), fs.mkdir(statusDir, { recursive: true })]);
  await replaceFile(hookPath, platform === "win32" ? CLAUDE_STATUS_HOOK : CLAUDE_STATUS_HOOK_PYTHON);
  if (platform !== "win32") await fs.chmod(hookPath, 0o755);
  await replaceFile(settingsPath, `${JSON.stringify(buildClaudeSettings(hookPath, platform), null, 2)}\n`);
  return { settingsPath, hookPath, statusDir };
}
