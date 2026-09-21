import fs from "node:fs/promises";
import path from "node:path";

// Scoped to this shell process: neither the user's profile nor global CLI settings are modified.
// Explicit CLI settings win. Invocation with an absolute executable path also remains untouched.
const SCRIPT = String.raw`
function global:Send-McwShellLocation {
  try {
    $mcwId = $env:MULTI_CLI_WORK_SESSION_ID
    if ($mcwId -notmatch '^[a-zA-Z0-9-]+$' -or -not $env:MULTI_CLI_WORK_STATUS_DIR) { return }
    [IO.Directory]::CreateDirectory($env:MULTI_CLI_WORK_STATUS_DIR) | Out-Null
    $mcwTarget = Join-Path $env:MULTI_CLI_WORK_STATUS_DIR ($mcwId + '.json')
    $mcwTemp = $mcwTarget + '.' + $PID + '.tmp'
    $mcwPayload = @{ sessionId = $mcwId; status = 'idle'; event = 'ShellReady'; provider = 'shell'; generation = $env:MULTI_CLI_WORK_GENERATION; cwd = $PWD.Path; at = [DateTime]::UtcNow.ToString('o') }
    [IO.File]::WriteAllText($mcwTemp, ($mcwPayload | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $mcwTemp -Destination $mcwTarget -Force
  } catch { }
}
foreach ($mcwProvider in @('claude', 'codex')) {
  if (-not (Test-Path ('Alias:' + $mcwProvider)) -and -not (Test-Path ('Function:' + $mcwProvider))) {
    Set-Alias -Name $mcwProvider -Value (Join-Path $PSScriptRoot ($mcwProvider + '-proxy.ps1')) -Scope Global
  }
}
`;

function proxyScript(provider: "claude" | "codex"): string {
  const variable = provider === "claude" ? "MULTI_CLI_WORK_CLAUDE_SETTINGS" : "MULTI_CLI_WORK_CODEX_PROFILE";
  const flag = provider === "claude" ? "--settings" : "--profile";
  const pattern = provider === "claude" ? "^--settings(?:=|$)" : "^(--profile(?:=|$)|-p)";
  return String.raw`
$mcwCommand = Get-Command ${provider} -CommandType Application,ExternalScript -ErrorAction Stop | Select-Object -First 1
$mcwArgs = @($args)
if ($env:${variable} -and -not ($mcwArgs | Where-Object { $_ -match '${pattern}' })) {
  $mcwArgs = @('${flag}', $env:${variable}) + $mcwArgs
}
$mcwExitCode = 0
try {
  if ($MyInvocation.ExpectingInput) { $input | & $mcwCommand.Source @mcwArgs }
  else { & $mcwCommand.Source @mcwArgs }
  $mcwExitCode = $LASTEXITCODE
} finally { Send-McwShellLocation }
exit $mcwExitCode
`;
}

export async function ensurePowerShellIntegration(userData: string): Promise<string> {
  const scriptPath = path.join(userData, "hooks", "shell-integration.ps1");
  await fs.mkdir(path.dirname(scriptPath), { recursive: true });
  await fs.writeFile(scriptPath, SCRIPT, "utf8");
  for (const provider of ["claude", "codex"] as const) {
    await fs.writeFile(path.join(path.dirname(scriptPath), `${provider}-proxy.ps1`), proxyScript(provider), "utf8");
  }
  return scriptPath;
}
