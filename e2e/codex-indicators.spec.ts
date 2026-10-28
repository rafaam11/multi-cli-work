import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test.skip(process.platform !== "win32", "Windows Codex hook runner");

test("Codex hooks reach the real pane metadata and turn status", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-codex-indicators-"));
  const userData = path.join(root, "user-data");
  const bin = path.join(root, "bin");
  const projectId = "11111111-1111-4111-8111-111111111111";
  const now = new Date().toISOString();
  await fs.mkdir(bin);
  await fs.writeFile(path.join(root, "projects.json"), JSON.stringify({ schemaVersion: 1, updatedAt: now, projects: {
    [projectId]: { id: projectId, rootPath: root, displayName: "Codex Chips", sources: ["manual"], providerRefs: { claude: [], codex: [] }, status: null, memo: "", tracks: [], hidden: false, order: 0, createdAt: now, updatedAt: now },
  } }));
  await fs.writeFile(path.join(bin, "fake.cjs"), `
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
if (process.argv.includes('--version')) { console.log('codex test'); process.exit(0); }
const phasePath = ${JSON.stringify(path.join(root, "phase"))};
function hook(event) {
  cp.execFileSync(process.execPath, [${JSON.stringify(path.join(userData, "provider-hooks", "codex-session-start.cjs"))}], { windowsHide: true, input: JSON.stringify({ hook_event_name: event, session_id: 'codex-owned', cwd: ${JSON.stringify(root)}, model: 'codex-probe', permission_mode: 'plan', tool_name: 'Bash' }) });
}
hook('SessionStart'); hook('PreToolUse'); console.log('HOOKS_READY');
const timer = setInterval(() => { if (fs.existsSync(phasePath)) { hook('Stop'); clearInterval(timer); console.log('TURN_STOPPED'); } }, 100);
process.stdin.resume();
`);
  await fs.writeFile(path.join(bin, "codex.cmd"), `@echo off\r\n"${process.execPath}" "%~dp0fake.cjs" %*\r\n`);
  // The built-in resolver prefers codex.exe over cmd shims even across PATH entries.
  const literal = (value: string) => '@"' + value.replaceAll('"', '""') + '"';
  const stub = `using System; using System.Diagnostics; class Probe { static int Main(string[] args) { if (Array.IndexOf(args, "--version") >= 0) { Console.WriteLine("codex probe"); return 0; } var p = Process.Start(new ProcessStartInfo { FileName = ${literal(process.execPath)}, Arguments = "\\\"" + ${literal(path.join(bin, "fake.cjs"))} + "\\\"", UseShellExecute = false }); p.WaitForExit(); return p.ExitCode; } }`;
  const compile = `$ErrorActionPreference='Stop'; Add-Type -TypeDefinition @'\n${stub}\n'@ -OutputAssembly '${path.join(bin, "codex.exe").replaceAll("'", "''")}' -OutputType ConsoleApplication`;
  await promisify(execFile)("powershell.exe", ["-NoProfile", "-EncodedCommand", Buffer.from(compile, "utf16le").toString("base64")], { windowsHide: true });
  // Keep all test windows hidden while the actual renderer, PTY and hook pipeline run.
  const entry = path.join(root, "main.cjs");
  await fs.writeFile(entry, `const {BrowserWindow}=require('electron'); BrowserWindow.prototype.show=function(){}; BrowserWindow.prototype.showInactive=function(){}; require(${JSON.stringify(path.resolve("out/main/index.js"))});`);
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"));
  const app = await electron.launch({ args: [entry], env: {
    ...inherited, Path: `${bin};${process.env.Path ?? process.env.PATH}`, CODEX_HOME: path.join(root, "codex-home"),
    MULTI_CLI_WORK_USER_DATA: userData, MULTI_CLI_WORK_REGISTRY_PATH: path.join(root, "projects.json"),
    MULTI_CLI_WORK_AGENTS_PATH: path.join(root, "agents.json"), MULTI_CLI_WORK_WORK_PROJECTS_PATH: path.join(root, "work-projects.json"),
    MULTI_CLI_WORK_WORKTREES_PATH: path.join(root, "worktrees.json"), MULTI_CLI_WORK_WORKTREE_SCRIPTS_PATH: path.join(root, "worktree-scripts.json"),
    MULTI_CLI_WORK_CLAUDE_CONFIG_DIR: path.join(root, "claude-config"), MULTI_CLI_WORK_PR_REVIEWS_PATH: path.join(root, "reviews.json"),
    MULTI_CLI_WORK_WORKSPACE_PATH: path.join(root, "workspace.json"), MULTI_CLI_WORK_PROJECT_TAGS_PATH: path.join(root, "tags.json"),
  } });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Codex Chips 폴더 선택" }).click();
    await page.getByRole("button", { name: "새 Codex 세션", exact: true }).first().click();
    await expect.poll(() => page.evaluate(async () => (await window.multiCliWork.terminals.list()).length)).toBe(1);
    const session = await page.evaluate(async () => (await window.multiCliWork.terminals.list())[0]);
    await expect.poll(() => page.evaluate(async (id) => (await window.multiCliWork.terminals.attach(id)).replay, session.id)).toContain("HOOKS_READY");
    await expect(page.getByTestId("pane-chip").filter({ hasText: "codex-probe" })).toHaveCount(1);
    await expect(page.getByTestId("pane-chip").filter({ hasText: "계획" })).toHaveCount(1);
    await expect(page.getByTestId("pane-chip").filter({ hasText: "Bash" })).toHaveCount(1);
    await fs.writeFile(path.join(root, "phase"), "stop");
    await expect.poll(() => page.evaluate(async (id) => (await window.multiCliWork.terminals.list()).find((item) => item.id === id)?.status, session.id)).toBe("awaiting-input");
    await expect(page.getByTestId("pane-chip").filter({ hasText: "Bash" })).toHaveCount(0);
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }).catch(() => undefined);
    await app.close();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
