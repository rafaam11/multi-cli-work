import fs from "node:fs/promises";
import path from "node:path";

/**
 * The jk-coding-cli client the app drops into `userData/bin`. Only sessions the app spawns can use
 * it: the bin directory is prepended to their PATH, and the per-run token in their environment is
 * what the control server accepts. Nothing is installed system-wide — the same approach as the
 * Claude hook overlay in `providers/claude-integration.ts`.
 */

/** Fixed local pipe the control server listens on; `JK_CODING_CLI_PIPE` overrides it in dev/tests. */
export const CONTROL_PIPE_NAME = "jk-coding-cli";
export const CONTROL_PIPE_ENV = "JK_CODING_CLI_PIPE";
/** Rotated on every app start and handed only to app-spawned sessions. */
export const CONTROL_TOKEN_ENV = "JK_CODING_CLI_TOKEN";

export const CONTROL_CLI_SCRIPT = String.raw`[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$ErrorActionPreference = "Stop"

function Fail([string]$message) {
  [Console]::Error.WriteLine($message)
  exit 1
}

$pipeName = $env:JK_CODING_CLI_PIPE
if ([string]::IsNullOrWhiteSpace($pipeName)) { $pipeName = "jk-coding-cli" }
$token = $env:JK_CODING_CLI_TOKEN
if ([string]::IsNullOrWhiteSpace($token)) {
  Fail "jk-coding-cli: 멀티 터미널 작업기 안의 세션에서만 사용할 수 있습니다 (토큰 없음)."
}

$HELP = @"
jk-coding-cli - 멀티 터미널 작업기 제어 CLI (별칭: jk)

명령:
  list [--project <id>] [--json]
      세션 목록을 보여줍니다.
  send <sessionId> <텍스트...> | send <sessionId> --stdin
      다른 세션의 프롬프트에 텍스트를 보냅니다. 여러 줄은 --stdin으로 파이프하세요.
  read <sessionId> [--lines N] [--json]
      세션 화면의 마지막 출력을 읽습니다.
  wait <sessionId> [--status <status>] [--timeout <초>] [--json]
      세션이 지정 상태가 될 때까지 기다립니다. 기본 상태: awaiting-input.
      상태: starting working awaiting-input awaiting-approval idle exited error
  spawn --project <id> [--worktree <id>] --agent <kind> [--json]
      새 세션을 시작합니다. kind 예: powershell, claude, codex
"@

if ($args.Count -lt 1) { Fail $HELP }
$command = [string]$args[0]
if ($command -in @("help", "--help", "-h")) { Write-Output $HELP; exit 0 }
$rest = @($args | Select-Object -Skip 1)

$flags = @{}
$positional = New-Object System.Collections.Generic.List[string]
for ($i = 0; $i -lt $rest.Count; $i++) {
  $arg = [string]$rest[$i]
  if ($arg -like "--*") {
    $name = $arg.Substring(2)
    if ($name -in @("json", "stdin")) { $flags[$name] = $true }
    else {
      if ($i + 1 -ge $rest.Count) { Fail "옵션 $arg 에 값이 없습니다." }
      $i++
      $flags[$name] = [string]$rest[$i]
    }
  } else { $positional.Add($arg) }
}

$requestArgs = @{}
switch ($command) {
  "list" {
    if ($flags.ContainsKey("project")) { $requestArgs.projectId = $flags["project"] }
    break
  }
  "send" {
    if ($positional.Count -lt 1) { Fail "send: 대상 sessionId가 필요합니다." }
    $requestArgs.sessionId = $positional[0]
    if ($flags.ContainsKey("stdin")) { $requestArgs.text = [Console]::In.ReadToEnd() }
    elseif ($positional.Count -ge 2) { $requestArgs.text = (@($positional) | Select-Object -Skip 1) -join " " }
    else { Fail "send: 보낼 텍스트가 없습니다. 텍스트를 인자로 주거나 --stdin으로 파이프하세요." }
    if ([string]::IsNullOrWhiteSpace([string]$requestArgs.text)) { Fail "send: 보낼 텍스트가 비어 있습니다." }
    break
  }
  "read" {
    if ($positional.Count -lt 1) { Fail "read: sessionId가 필요합니다." }
    $requestArgs.sessionId = $positional[0]
    if ($flags.ContainsKey("lines")) { $requestArgs.lines = [int]$flags["lines"] }
    break
  }
  "wait" {
    if ($positional.Count -lt 1) { Fail "wait: sessionId가 필요합니다." }
    $requestArgs.sessionId = $positional[0]
    if ($flags.ContainsKey("status")) { $requestArgs.status = $flags["status"] }
    if ($flags.ContainsKey("timeout")) { $requestArgs.timeoutSeconds = [int]$flags["timeout"] }
    break
  }
  "spawn" {
    if (-not $flags.ContainsKey("project")) { Fail "spawn: --project <id>가 필요합니다." }
    if (-not $flags.ContainsKey("agent")) { Fail "spawn: --agent <kind>가 필요합니다." }
    $requestArgs.projectId = $flags["project"]
    $requestArgs.kind = $flags["agent"]
    if ($flags.ContainsKey("worktree")) { $requestArgs.worktreeId = $flags["worktree"] }
    break
  }
  default { Fail ("알 수 없는 명령: " + $command + [Environment]::NewLine + $HELP) }
}

$request = [ordered]@{
  token = $token
  callerSessionId = $env:MULTI_CLI_WORK_SESSION_ID
  command = $command
  args = $requestArgs
}

$pipe = $null
$line = $null
try {
  $pipe = New-Object System.IO.Pipes.NamedPipeClientStream(".", $pipeName, [System.IO.Pipes.PipeDirection]::InOut)
  try { $pipe.Connect(3000) } catch {
    Fail "jk-coding-cli: 앱에 연결할 수 없습니다. 멀티 터미널 작업기가 실행 중인지 확인하세요."
  }
  $writer = New-Object System.IO.StreamWriter($pipe, [Text.UTF8Encoding]::new($false))
  $writer.AutoFlush = $true
  $writer.WriteLine(($request | ConvertTo-Json -Compress -Depth 8))
  $reader = New-Object System.IO.StreamReader($pipe, [Text.UTF8Encoding]::new($false))
  $line = $reader.ReadLine()
} finally {
  if ($pipe) { $pipe.Dispose() }
}

if ([string]::IsNullOrWhiteSpace($line)) { Fail "jk-coding-cli: 앱이 응답하지 않았습니다." }
try { $response = $line | ConvertFrom-Json } catch { Fail "jk-coding-cli: 응답을 해석할 수 없습니다: $line" }
if (-not $response.ok) { Fail "jk-coding-cli: $($response.error)" }
$result = $response.result

if ($flags.ContainsKey("json")) {
  Write-Output ($result | ConvertTo-Json -Depth 8)
  exit 0
}

switch ($command) {
  "list" {
    if (-not $result.sessions -or @($result.sessions).Count -eq 0) { Write-Output "(세션 없음)"; break }
    foreach ($session in $result.sessions) {
      $label = if ($session.name) { $session.name } elseif ($session.title) { $session.title } else { "-" }
      $project = if ($session.projectName) { $session.projectName } else { "-" }
      Write-Output ("{0}  {1,-10}  {2,-17}  {3}  {4}" -f $session.id, $session.kind, $session.status, $project, $label)
    }
    break
  }
  "send" { Write-Output ("전송됨 -> " + $result.sessionId); break }
  "read" { if ($null -ne $result.text) { Write-Output $result.text }; break }
  "wait" { Write-Output ($result.sessionId + ": " + $result.status); break }
  "spawn" { Write-Output $result.sessionId; break }
}
exit 0
`;

const CONTROL_CLI_CMD = [
  "@echo off",
  'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0jk-coding-cli.ps1" %*',
  "exit /b %ERRORLEVEL%",
  "",
].join("\r\n");

async function replaceFile(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tempPath, content, "utf8");
    await fs.rename(tempPath, filePath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

export async function ensureControlCli(userDataPath: string): Promise<{ binDir: string }> {
  const binDir = path.join(userDataPath, "bin");
  await fs.mkdir(binDir, { recursive: true });
  await replaceFile(path.join(binDir, "jk-coding-cli.ps1"), CONTROL_CLI_SCRIPT);
  await replaceFile(path.join(binDir, "jk-coding-cli.cmd"), CONTROL_CLI_CMD);
  await replaceFile(path.join(binDir, "jk.cmd"), CONTROL_CLI_CMD);
  return { binDir };
}
