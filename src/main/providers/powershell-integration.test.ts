// @vitest-environment node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { ensurePowerShellIntegration } from "./powershell-integration";

it.skipIf(process.platform !== "win32")("links nested CLIs while preserving arguments and restores the shell location on return", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-shell-"));
  try {
    const script = await ensurePowerShellIntegration(root);
    for (const name of ["claude", "codex"]) {
      await fs.writeFile(path.join(root, `${name}.ps1`), '[Console]::Out.WriteLine((@{ argv = @($args); session = $env:MULTI_CLI_WORK_SESSION_ID } | ConvertTo-Json -Compress))');
    }
    const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
      `. '${script.replaceAll("'", "''")}'; claude 'hello world' --resume abc; codex resume xyz; codex --profile custom 'hello world'`], {
      env: { ...process.env, PATH: `${root};${process.env.PATH}`, MULTI_CLI_WORK_SESSION_ID: "shell-1", MULTI_CLI_WORK_GENERATION: "gen-1", MULTI_CLI_WORK_STATUS_DIR: root, MULTI_CLI_WORK_CLAUDE_SETTINGS: "C:\\App Data\\settings.json", MULTI_CLI_WORK_CODEX_PROFILE: "multi-cli-work" },
      cwd: root,
    });
    const output = stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
    expect(output[0]).toEqual({ argv: ["--settings", "C:\\App Data\\settings.json", "hello world", "--resume", "abc"], session: "shell-1" });
    expect(output[1].argv).toEqual(["--profile", "multi-cli-work", "resume", "xyz"]);
    expect(output[2].argv).toEqual(["--profile", "custom", "hello world"]);
    expect(JSON.parse(await fs.readFile(path.join(root, "shell-1.json"), "utf8"))).toMatchObject({ provider: "shell", event: "ShellReady", cwd: root, generation: "gen-1" });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}, 20_000);

it.skipIf(process.platform !== "win32")("forwards pipeline input to a native CLI", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-shell-pipe-"));
  try {
    const script = await ensurePowerShellIntegration(root);
    await fs.writeFile(path.join(root, "read.cjs"), "if(process.argv.includes('--fail'))process.exit(7); process.stdin.setEncoding('utf8'); let s=''; process.stdin.on('data', c=>s+=c); process.stdin.on('end', ()=>console.log(JSON.stringify(s.trim())));");
    await fs.writeFile(path.join(root, "codex.cmd"), `@echo off\r\n"${process.execPath}" "%~dp0read.cjs" %*\r\n`);
    const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `. '${script.replaceAll("'", "''")}'; 'pipeline prompt' | codex exec -`], {
      env: { ...process.env, PATH: `${root};${process.env.PATH}` }, timeout: 5_000,
    });
    expect(JSON.parse(stdout.trim())).toBe("pipeline prompt");
    const failure = await promisify(execFile)("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `. '${script.replaceAll("'", "''")}'; codex --fail; $mcwSuccess = $?; @{ success = $mcwSuccess; code = $LASTEXITCODE } | ConvertTo-Json -Compress`], {
      env: { ...process.env, PATH: `${root};${process.env.PATH}` }, timeout: 5_000,
    });
    expect(JSON.parse(failure.stdout.trim())).toEqual({ success: false, code: 7 });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}, 10_000);
