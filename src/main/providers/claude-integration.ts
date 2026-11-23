import fs from "node:fs/promises";
import path from "node:path";
import { LINEAR_RECORD_MARKER } from "../linear/linear-brief";

/**
 * Stop 리마인드 문구(설계 2026-11-23 §4.5). Linear 맥락이 실린 Claude 세션에서 지난 리마인드 이후 HEAD가
 * 바뀌었을 때만 한 번 나간다 — Claude는 이 문구로 한 턴을 더 돌아 Linear에 기록을 남긴다.
 */
export const LINEAR_RECORD_REMINDER =
  "방금 새 커밋이 생겼다. 관련 Linear 이슈에 진행·결정·다음 할 일을 댓글 1건으로 남겨라(첫 줄은 [mcw-claude]). 이미 남겼으면 바로 멈춰라.";

/**
 * 비ASCII 문자를 `\uXXXX`로. Windows PowerShell 5.1은 BOM 없는 .ps1의 한글을 ANSI 코드 페이지로 읽으므로
 * 스크립트에는 이 표기만 넣고 `[regex]::Unescape`로 되살린다. 같은 표기는 Python 문자열 안에서도 유효하다.
 */
function asciiEscapes(text: string): string {
  return text.replace(/[^\x00-\x7F]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

const LINEAR_REMINDER_ESCAPED = asciiEscapes(LINEAR_RECORD_REMINDER);

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
  "SubagentStart", "SubagentStop", "PreCompact", "PostCompact", "PostModelSwitch", "TaskCreated", "TaskCompleted",
] as const;

interface ClaudeHookHandler {
  type: "command";
  command: string;
  args: string[];
  timeout: 10;
}

export interface ClaudeSettingsOverlay {
  hooks: Record<(typeof CLAUDE_EVENTS)[number], Array<{ hooks: ClaudeHookHandler[] }>>;
  /** Claude Code's colour theme for the sessions the app starts — present only while it follows the app (claude-theme.ts). */
  theme?: string;
}

export function buildClaudeSettings(
  hookPath: string,
  platform: NodeJS.Platform = process.platform,
  theme: string | null = null,
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
    ...(theme ? { theme } : {}),
  };
}

export const CLAUDE_STATUS_HOOK = String.raw`$ErrorActionPreference = "SilentlyContinue"
$sessionId = $env:MULTI_CLI_WORK_SESSION_ID
$statusDir = $env:MULTI_CLI_WORK_STATUS_DIR
if ([string]::IsNullOrWhiteSpace($sessionId) -or $sessionId -notmatch '^[a-zA-Z0-9-]+$') { exit 0 }
if ([string]::IsNullOrWhiteSpace($statusDir)) { exit 0 }

try { $inputValue = [Console]::In.ReadToEnd() | ConvertFrom-Json } catch { exit 0 }
try {
  $activityDir = $env:MULTI_CLI_WORK_ACTIVITY_DIR
  if ($activityDir -and $env:MULTI_CLI_WORK_GENERATION) {
    [IO.Directory]::CreateDirectory($activityDir) | Out-Null
    $activityId = [guid]::NewGuid().ToString("N")
    $activity = [ordered]@{ id = $activityId; sessionId = $sessionId; generation = $env:MULTI_CLI_WORK_GENERATION; provider = "claude"; event = [string]$inputValue.hook_event_name; at = [DateTime]::UtcNow.ToString("o") }
    foreach ($pair in @(@("tool_name", "toolName"), @("tool_use_id", "toolCallId"), @("agent_id", "agentId"), @("agent_type", "agentType"), @("model", "model"), @("task_id", "taskId"), @("task_subject", "taskSubject"))) {
      $field = [string]$inputValue.($pair[0])
      if ($field) { $field = [regex]::Replace($field, '[\x00-\x1f\x7f]', ' '); $activity[$pair[1]] = $field.Substring(0, [Math]::Min(200, $field.Length)) }
    }
    if ($inputValue.to_model) { $activity.model = [string]$inputValue.to_model }
    $activityTarget = Join-Path $activityDir ($activityId + ".json")
    $activityTemp = $activityTarget + ".tmp"
    [IO.File]::WriteAllText($activityTemp, ($activity | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $activityTemp -Destination $activityTarget -Force -ErrorAction Stop
  }
} catch { }
if ($inputValue.hook_event_name -in @("SubagentStart", "SubagentStop", "PreCompact", "PostCompact", "PostModelSwitch", "TaskCreated", "TaskCompleted")) { exit 0 }
if ($inputValue.agent_id) { exit 0 }
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
  # A unique temp per run: parallel tool calls fire several hooks at once for the same target.
  $temp = $target + "." + $PID + "." + [guid]::NewGuid().ToString("N") + ".tmp"
  $payload = [ordered]@{ sessionId = $sessionId; status = $status; event = $eventName; at = [DateTime]::UtcNow.ToString("o") }
  $payload.provider = "claude"
  if ($env:MULTI_CLI_WORK_GENERATION) { $payload.generation = $env:MULTI_CLI_WORK_GENERATION }
  if ($inputValue.cwd) { $payload.cwd = [string]$inputValue.cwd }
  if ($inputValue.session_id) { $payload.providerConversationId = [string]$inputValue.session_id }
  if ($inputValue.transcript_path) { $payload.transcriptPath = [string]$inputValue.transcript_path }
  try {
    [IO.File]::WriteAllText($temp, ($payload | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    # Another hook may hold the target for a moment; the rename is retried rather than given up.
    # ErrorAction Stop matters: under SilentlyContinue a failed Move-Item would not throw at all.
    for ($attempt = 0; $attempt -lt 5; $attempt++) {
      try { Move-Item -LiteralPath $temp -Destination $target -Force -ErrorAction Stop; break }
      catch { Start-Sleep -Milliseconds 20 }
    }
  } finally {
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
  }
} catch { }

# On SessionStart, hand the work-project brief to Claude as additional context. The app sets
# MULTI_CLI_WORK_PROJECT_BRIEF only for sessions whose folder belongs to a work project; any
# failure here degrades to a session without context, never to a failed hook (exit stays 0).
if ($eventName -eq "SessionStart") {
  $briefPath = $env:MULTI_CLI_WORK_PROJECT_BRIEF
  if (-not [string]::IsNullOrWhiteSpace($briefPath)) {
    try {
      $brief = [IO.File]::ReadAllText($briefPath, [Text.UTF8Encoding]::new($false))
      if (-not [string]::IsNullOrWhiteSpace($brief)) {
        $hookOutput = @{ hookSpecificOutput = @{ hookEventName = "SessionStart"; additionalContext = $brief } }
        # Windows PowerShell 5.1 leaves Korean unescaped and the console writes it in the ANSI code page
        # (CP949), which Claude then reads as broken UTF-8. Escaping to \uXXXX keeps stdout pure ASCII.
        $json = $hookOutput | ConvertTo-Json -Compress -Depth 4
        $json = [regex]::Replace($json, '[^\x00-\x7F]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
        [Console]::Out.Write($json)
      }
    } catch { }
  }
}

# Linear record reminder: only for sessions whose brief carries the marker. A shell tool call of this
# session that runs git commit records HEAD before (PreToolUse) and compares after (PostToolUse); if that
# command moved HEAD it leaves a pending flag and the next Stop blocks once. HEAD moved by anything else
# (another session in the same tree, a pull, a checkout) never reminds.
$linearStateDir = $env:MULTI_CLI_WORK_LINEAR_STATE_DIR
if ($linearStateDir -and $env:MULTI_CLI_WORK_PROJECT_BRIEF -and $inputValue.cwd) {
  try {
    $preHeadFile = Join-Path $linearStateDir ($sessionId + ".prehead")
    $pendingFile = Join-Path $linearStateDir ($sessionId + ".pending")
    $isCommit = ([string]$inputValue.tool_name) -in @("Bash", "PowerShell") -and ([string]$inputValue.tool_input.command) -match '\bgit\b[^|;&]*\bcommit\b'
    if ($eventName -eq "Stop") {
      if (-not $inputValue.stop_hook_active -and (Test-Path -LiteralPath $pendingFile)) {
        Remove-Item -LiteralPath $pendingFile -Force
        $reason = [regex]::Unescape('${LINEAR_REMINDER_ESCAPED}')
        $json = @{ decision = "block"; reason = $reason } | ConvertTo-Json -Compress
        $json = [regex]::Replace($json, '[^\x00-\x7F]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
        [Console]::Out.Write($json)
      }
    } elseif ($isCommit -and ($eventName -eq "PreToolUse" -or $eventName -eq "PostToolUse")) {
      $briefText = [IO.File]::ReadAllText($env:MULTI_CLI_WORK_PROJECT_BRIEF, [Text.UTF8Encoding]::new($false))
      if ($briefText.Contains("${LINEAR_RECORD_MARKER}")) {
        $head = (& git -C ([string]$inputValue.cwd) rev-parse HEAD 2>$null)
        # Missing git leaves $LASTEXITCODE stale, so an empty $head is what decides "no HEAD".
        if ($LASTEXITCODE -ne 0 -or -not $head) { $head = "" } else { $head = ([string]$head).Trim() }
        if ($eventName -eq "PreToolUse") {
          if ($head) {
            [IO.Directory]::CreateDirectory($linearStateDir) | Out-Null
            [IO.File]::WriteAllText($preHeadFile, $head, [Text.UTF8Encoding]::new($false))
          }
        } elseif (Test-Path -LiteralPath $preHeadFile) {
          $before = ([IO.File]::ReadAllText($preHeadFile)).Trim()
          Remove-Item -LiteralPath $preHeadFile -Force
          if ($head -and $head -ne $before) { [IO.File]::WriteAllText($pendingFile, $head, [Text.UTF8Encoding]::new($false)) }
        }
      }
    }
  } catch { }
}
exit 0
`;

export const CLAUDE_STATUS_HOOK_PYTHON = String.raw`#!/usr/bin/env python3
import datetime, json, os, re, sys, tempfile
session_id = os.environ.get("MULTI_CLI_WORK_SESSION_ID", "")
status_dir = os.environ.get("MULTI_CLI_WORK_STATUS_DIR", "")
if not re.fullmatch(r"[a-zA-Z0-9-]+", session_id) or not status_dir: raise SystemExit(0)
try: value = json.load(sys.stdin)
except Exception: raise SystemExit(0)
try:
    activity_dir = os.environ.get("MULTI_CLI_WORK_ACTIVITY_DIR")
    generation = os.environ.get("MULTI_CLI_WORK_GENERATION")
    if activity_dir and generation:
        import uuid
        os.makedirs(activity_dir, exist_ok=True)
        activity_id = uuid.uuid4().hex
        activity = dict(id=activity_id, sessionId=session_id, generation=generation, provider="claude", event=str(value.get("hook_event_name", "")), at=datetime.datetime.now(datetime.timezone.utc).isoformat())
        for source, key in (("tool_name", "toolName"), ("tool_use_id", "toolCallId"), ("agent_id", "agentId"), ("agent_type", "agentType"), ("model", "model"), ("task_id", "taskId"), ("task_subject", "taskSubject")):
            if value.get(source): activity[key] = re.sub(r"[\x00-\x1f\x7f]", " ", str(value[source]))[:200]
        if value.get("to_model"): activity["model"] = str(value["to_model"])[:200]
        target_activity = os.path.join(activity_dir, activity_id + ".json")
        with open(target_activity + ".tmp", "w", encoding="utf-8") as output: json.dump(activity, output)
        os.replace(target_activity + ".tmp", target_activity)
except Exception: pass
if value.get("hook_event_name") in ("SubagentStart", "SubagentStop", "PreCompact", "PostCompact", "PostModelSwitch", "TaskCreated", "TaskCompleted"): raise SystemExit(0)
if value.get("agent_id"): raise SystemExit(0)
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
    payload["provider"] = "claude"
    if os.environ.get("MULTI_CLI_WORK_GENERATION"): payload["generation"] = os.environ["MULTI_CLI_WORK_GENERATION"]
    for source, target_key in (("cwd", "cwd"), ("session_id", "providerConversationId"), ("transcript_path", "transcriptPath")):
        if isinstance(value.get(source), str) and value[source]: payload[target_key] = value[source]
    fd, temporary = tempfile.mkstemp(prefix=session_id + ".", suffix=".tmp", dir=status_dir)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output: json.dump(payload, output, separators=(",", ":"))
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary): os.remove(temporary)
except Exception: pass
# On SessionStart, hand the work-project brief to Claude as additional context. Failures degrade
# to a session without context, never to a failed hook.
if event == "SessionStart":
    brief_path = os.environ.get("MULTI_CLI_WORK_PROJECT_BRIEF", "")
    if brief_path:
        try:
            with open(brief_path, "r", encoding="utf-8") as brief_file: brief = brief_file.read()
            if brief.strip():
                json.dump(dict(hookSpecificOutput=dict(hookEventName="SessionStart", additionalContext=brief)), sys.stdout)
        except Exception: pass
# Linear record reminder: only for sessions whose brief carries the marker. A shell tool call of this
# session that runs git commit records HEAD before (PreToolUse) and compares after (PostToolUse); if that
# command moved HEAD it leaves a pending flag and the next Stop blocks once. HEAD moved by anything else
# (another session in the same tree, a pull, a checkout) never reminds.
linear_state_dir = os.environ.get("MULTI_CLI_WORK_LINEAR_STATE_DIR", "")
linear_brief_path = os.environ.get("MULTI_CLI_WORK_PROJECT_BRIEF", "")
linear_cwd = value.get("cwd")
if linear_state_dir and linear_brief_path and isinstance(linear_cwd, str) and linear_cwd:
    try:
        pre_head_file = os.path.join(linear_state_dir, session_id + ".prehead")
        pending_file = os.path.join(linear_state_dir, session_id + ".pending")
        tool_input = value.get("tool_input") if isinstance(value.get("tool_input"), dict) else {}
        is_commit = value.get("tool_name") in ("Bash", "PowerShell") and re.search(r"\bgit\b[^|;&]*\bcommit\b", str(tool_input.get("command", ""))) is not None
        if event == "Stop":
            if not value.get("stop_hook_active") and os.path.exists(pending_file):
                os.remove(pending_file)
                json.dump(dict(decision="block", reason="${LINEAR_REMINDER_ESCAPED}"), sys.stdout)
        elif is_commit and event in ("PreToolUse", "PostToolUse"):
            with open(linear_brief_path, "r", encoding="utf-8") as brief_file: has_marker = "${LINEAR_RECORD_MARKER}" in brief_file.read()
            if has_marker:
                import subprocess
                result = subprocess.run(["git", "-C", linear_cwd, "rev-parse", "HEAD"], capture_output=True, text=True, timeout=3)
                head = result.stdout.strip() if result.returncode == 0 else ""
                if event == "PreToolUse":
                    if head:
                        os.makedirs(linear_state_dir, exist_ok=True)
                        with open(pre_head_file, "w", encoding="utf-8") as handle: handle.write(head)
                elif os.path.exists(pre_head_file):
                    with open(pre_head_file, "r", encoding="utf-8") as handle: before = handle.read().strip()
                    os.remove(pre_head_file)
                    if head and head != before:
                        with open(pending_file, "w", encoding="utf-8") as handle: handle.write(head)
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
  await writeClaudeSettings({ settingsPath, hookPath }, platform, null);
  return { settingsPath, hookPath, statusDir };
}

/** Rewrites the app-owned settings overlay — on start, and again whenever the theme it carries changes. */
export async function writeClaudeSettings(
  integration: { settingsPath: string; hookPath: string },
  platform: NodeJS.Platform,
  theme: string | null,
): Promise<void> {
  await replaceFile(
    integration.settingsPath,
    `${JSON.stringify(buildClaudeSettings(integration.hookPath, platform, theme), null, 2)}\n`,
  );
}
