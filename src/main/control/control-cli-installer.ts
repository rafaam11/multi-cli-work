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
/** Platform-independent pipe:// or tcp:// endpoint for clients introduced in v1.5. */
export const CONTROL_ENDPOINT_ENV = "JK_CODING_CLI_ENDPOINT";
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

export const CONTROL_CLI_PYTHON = String.raw`#!/usr/bin/env python3
import json, os, socket, sys

def fail(message):
    print(message, file=sys.stderr)
    raise SystemExit(1)

def parse(argv):
    if not argv or argv[0] in ("help", "--help", "-h"):
        print("jk-coding-cli: list|send|read|wait|spawn [options]")
        raise SystemExit(0)
    command, rest, flags, positional = argv[0], argv[1:], {}, []
    i = 0
    while i < len(rest):
        value = rest[i]
        if value.startswith("--"):
            name = value[2:]
            if name in ("json", "stdin"): flags[name] = True
            else:
                i += 1
                if i >= len(rest): fail("옵션 %s 에 값이 없습니다." % value)
                flags[name] = rest[i]
        else: positional.append(value)
        i += 1
    args = {}
    if command == "list":
        if "project" in flags: args["projectId"] = flags["project"]
    elif command == "send":
        if not positional: fail("send: 대상 sessionId가 필요합니다.")
        args["sessionId"] = positional[0]
        args["text"] = sys.stdin.read() if flags.get("stdin") else " ".join(positional[1:])
        if not args["text"].strip(): fail("send: 보낼 텍스트가 비어 있습니다.")
    elif command in ("read", "wait"):
        if not positional: fail(command + ": sessionId가 필요합니다.")
        args["sessionId"] = positional[0]
        if "lines" in flags: args["lines"] = int(flags["lines"])
        if "status" in flags: args["status"] = flags["status"]
        if "timeout" in flags: args["timeoutSeconds"] = int(flags["timeout"])
    elif command == "spawn":
        if "project" not in flags or "agent" not in flags: fail("spawn: --project와 --agent가 필요합니다.")
        args.update(projectId=flags["project"], kind=flags["agent"])
        if "worktree" in flags: args["worktreeId"] = flags["worktree"]
    else: fail("알 수 없는 명령: " + command)
    return command, flags, args

command, flags, args = parse(sys.argv[1:])
token = os.environ.get("JK_CODING_CLI_TOKEN")
endpoint = os.environ.get("JK_CODING_CLI_ENDPOINT", "")
if not token: fail("jk-coding-cli: 멀티 터미널 작업기 안의 세션에서만 사용할 수 있습니다 (토큰 없음).")
if not endpoint.startswith("tcp://127.0.0.1:"): fail("jk-coding-cli: 지원하지 않는 제어 endpoint입니다.")
port = int(endpoint.rsplit(":", 1)[1])
request = dict(token=token, callerSessionId=os.environ.get("MULTI_CLI_WORK_SESSION_ID"), command=command, args=args)
try:
    with socket.create_connection(("127.0.0.1", port), timeout=3) as connection:
        connection.sendall((json.dumps(request, ensure_ascii=False, separators=(",", ":")) + "\n").encode())
        stream = connection.makefile("r", encoding="utf-8")
        response = json.loads(stream.readline())
except Exception as error: fail("jk-coding-cli: 앱에 연결할 수 없습니다: " + str(error))
if not response.get("ok"): fail("jk-coding-cli: " + str(response.get("error", "unknown error")))
result = response.get("result") or {}
if flags.get("json"): print(json.dumps(result, ensure_ascii=False)); raise SystemExit(0)
if command == "list":
    sessions = result.get("sessions", [])
    if not sessions: print("(세션 없음)")
    for item in sessions:
        print("%s  %-10s  %-17s  %s  %s" % (item["id"], item["kind"], item["status"], item.get("projectName") or "-", item.get("name") or item.get("title") or "-"))
elif command == "send": print("전송됨 -> " + result["sessionId"])
elif command == "read": print(result.get("text", ""))
elif command == "wait": print(result["sessionId"] + ": " + result["status"])
elif command == "spawn": print(result["sessionId"])
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

export async function ensureControlCli(
  userDataPath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<{ binDir: string }> {
  const binDir = path.join(userDataPath, "bin");
  await fs.mkdir(binDir, { recursive: true });
  if (platform === "win32") {
    await replaceFile(path.join(binDir, "jk-coding-cli.ps1"), CONTROL_CLI_SCRIPT);
    await replaceFile(path.join(binDir, "jk-coding-cli.cmd"), CONTROL_CLI_CMD);
    await replaceFile(path.join(binDir, "jk.cmd"), CONTROL_CLI_CMD);
  } else {
    const client = path.join(binDir, "jk-coding-cli");
    const alias = path.join(binDir, "jk");
    await replaceFile(client, CONTROL_CLI_PYTHON);
    await replaceFile(alias, CONTROL_CLI_PYTHON);
    await Promise.all([fs.chmod(client, 0o755), fs.chmod(alias, 0o755)]);
  }
  return { binDir };
}
