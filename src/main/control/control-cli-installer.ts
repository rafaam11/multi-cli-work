import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * The jk-coding-cli client the app drops into `userData/bin`. Only sessions the app spawns can use
 * it: the bin directory is prepended to their PATH, and the per-run token in their environment is
 * what the control server accepts. Nothing is installed system-wide — the same approach as the
 * Claude hook overlay in `providers/claude-integration.ts`.
 */

/** Prefix of the local pipe the control server listens on; `JK_CODING_CLI_PIPE` overrides it. */
export const CONTROL_PIPE_NAME = "jk-coding-cli";

/**
 * One pipe per userData. A fixed name let only the first instance listen — a dev build or an e2e run
 * next to the installed app got EADDRINUSE and its sessions silently lost `jk`. Sessions learn the
 * name from their environment, so nothing outside the app needs to know it.
 */
export function controlPipeNameFor(userDataPath: string, platform: NodeJS.Platform = process.platform): string {
  const resolved = path.resolve(userDataPath);
  const key = platform === "win32" ? resolved.toLowerCase() : resolved;
  return `${CONTROL_PIPE_NAME}-${crypto.createHash("sha1").update(key).digest("hex").slice(0, 8)}`;
}
export const CONTROL_PIPE_ENV = "JK_CODING_CLI_PIPE";

/**
 * The pipe this instance listens on. `JK_CODING_CLI_PIPE` overrides it — unless it came with a
 * session token, which means the app was started from a terminal of another instance (a dev build
 * run in the app it is building). That pipe is the parent's: taking it would leave this instance
 * without a server and point its sessions' `jk` at the parent, which refuses their token.
 */
export function resolveControlPipeName(
  env: NodeJS.ProcessEnv,
  userDataPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const explicit = env[CONTROL_PIPE_ENV];
  if (explicit && !env[CONTROL_TOKEN_ENV]) return explicit;
  return controlPipeNameFor(userDataPath, platform);
}
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
  status set <key> <텍스트...> [--color green|amber|red|blue|gray] [--session <id>]
  status clear [key] [--session <id>]
      패인 머리줄에 상태 칩을 붙이거나 뗍니다. 기본 대상은 지금 세션입니다.
  progress <0-100|busy|clear> [--state normal|error|warning] [--session <id>]
      패인 머리줄 밑 진행선을 채웁니다. busy는 진행률 없이 돌고 있다는 표시입니다.
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
  "status" {
    if ($positional.Count -lt 1) { Fail "status: set 또는 clear가 필요합니다." }
    $requestArgs.action = $positional[0]
    if ($flags.ContainsKey("session")) { $requestArgs.sessionId = $flags["session"] }
    if ($positional[0] -eq "set") {
      if ($positional.Count -lt 3) { Fail "status set: <key> <텍스트>가 필요합니다." }
      $requestArgs.key = $positional[1]
      $requestArgs.text = (@($positional) | Select-Object -Skip 2) -join " "
      if ($flags.ContainsKey("color")) { $requestArgs.color = $flags["color"] }
    } elseif ($positional.Count -ge 2) { $requestArgs.key = $positional[1] }
    break
  }
  "progress" {
    if ($positional.Count -lt 1) { Fail "progress: 0-100, busy, clear 중 하나가 필요합니다." }
    if ($flags.ContainsKey("session")) { $requestArgs.sessionId = $flags["session"] }
    $value = [string]$positional[0]
    if ($value -eq "clear") { $requestArgs.clear = $true }
    elseif ($value -eq "busy") { $requestArgs.state = "indeterminate" }
    else {
      $number = 0
      if (-not [int]::TryParse($value, [ref]$number)) { Fail "progress: 0-100 사이의 정수가 필요합니다." }
      $requestArgs.value = $number
      if ($flags.ContainsKey("state")) { $requestArgs.state = $flags["state"] }
    }
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
  "status" { Write-Output ("상태 칩 -> " + $result.sessionId); break }
  "progress" { Write-Output ("진행률 -> " + $result.sessionId); break }
}
exit 0
`;

/**
 * Git Bash (and so Claude Code's Bash tool on Windows) runs neither .cmd nor .ps1 by bare name — it
 * needs an extensionless script. It hands off to the same PowerShell client as the .cmd shim.
 */
const CONTROL_CLI_SH = [
  "#!/bin/sh",
  'dir=$(dirname "$0")',
  'if command -v cygpath >/dev/null 2>&1; then dir=$(cygpath -w "$dir"); fi',
  'exec powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$dir/jk-coding-cli.ps1" "$@"',
  "",
].join("\n");

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
        print("jk-coding-cli: list|send|read|wait|spawn|status|progress [options]")
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
    elif command == "status":
        if not positional: fail("status: set 또는 clear가 필요합니다.")
        args["action"] = positional[0]
        if "session" in flags: args["sessionId"] = flags["session"]
        if positional[0] == "set":
            if len(positional) < 3: fail("status set: <key> <텍스트>가 필요합니다.")
            args["key"], args["text"] = positional[1], " ".join(positional[2:])
            if "color" in flags: args["color"] = flags["color"]
        elif len(positional) >= 2: args["key"] = positional[1]
    elif command == "progress":
        if not positional: fail("progress: 0-100, busy, clear 중 하나가 필요합니다.")
        if "session" in flags: args["sessionId"] = flags["session"]
        if positional[0] == "clear": args["clear"] = True
        elif positional[0] == "busy": args["state"] = "indeterminate"
        else:
            try: args["value"] = int(positional[0])
            except ValueError: fail("progress: 0-100 사이의 정수가 필요합니다.")
            if "state" in flags: args["state"] = flags["state"]
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
elif command == "status": print("상태 칩 -> " + result["sessionId"])
elif command == "progress": print("진행률 -> " + result["sessionId"])
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
    // With a BOM: the shims run Windows PowerShell 5.1, which reads a BOM-less script in the ANSI
    // code page and turns its Korean text into parse errors on any non-UTF-8 Windows.
    await replaceFile(path.join(binDir, "jk-coding-cli.ps1"), `﻿${CONTROL_CLI_SCRIPT}`);
    await replaceFile(path.join(binDir, "jk-coding-cli.cmd"), CONTROL_CLI_CMD);
    await replaceFile(path.join(binDir, "jk.cmd"), CONTROL_CLI_CMD);
    await replaceFile(path.join(binDir, "jk-coding-cli"), CONTROL_CLI_SH);
    await replaceFile(path.join(binDir, "jk"), CONTROL_CLI_SH);
  } else {
    const client = path.join(binDir, "jk-coding-cli");
    const alias = path.join(binDir, "jk");
    await replaceFile(client, CONTROL_CLI_PYTHON);
    await replaceFile(alias, CONTROL_CLI_PYTHON);
    await Promise.all([fs.chmod(client, 0o755), fs.chmod(alias, 0o755)]);
  }
  return { binDir };
}
