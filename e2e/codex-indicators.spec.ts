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
const conversationId = 'codex-' + process.env.MULTI_CLI_WORK_SESSION_ID;
function hook(event) {
  cp.execFileSync(process.execPath, [${JSON.stringify(path.join(userData, "provider-hooks", "codex-session-start.cjs"))}], { windowsHide: true, input: JSON.stringify({ hook_event_name: event, session_id: conversationId, cwd: ${JSON.stringify(root)}, model: 'codex-probe', permission_mode: 'plan', tool_name: 'Bash' }) });
}
hook('SessionStart'); hook('PreToolUse'); console.log('HOOKS_READY');
const timer = setInterval(() => { if (fs.existsSync(phasePath)) { hook('Stop'); clearInterval(timer); console.log('TURN_STOPPED'); } }, 100);
process.stdin.resume();
`);
  await fs.writeFile(path.join(bin, "codex.cmd"), `@echo off\r\n"${process.execPath}" "%~dp0fake.cjs" %*\r\n`);
  // The built-in resolver prefers codex.exe over cmd shims even across PATH entries.
  const literal = (value: string) => '@"' + value.replaceAll('"', '""') + '"';
  const stub = `using System; using System.Diagnostics; class Probe { static int Main(string[] args) { if (Array.IndexOf(args, "--version") >= 0) { Console.WriteLine("codex probe"); return 0; } System.IO.File.WriteAllLines(System.IO.Path.Combine(${literal(root)}, "argv-" + Environment.GetEnvironmentVariable("MULTI_CLI_WORK_SESSION_ID") + ".txt"), args); var p = Process.Start(new ProcessStartInfo { FileName = ${literal(process.execPath)}, Arguments = "\\\"" + ${literal(path.join(bin, "fake.cjs"))} + "\\\"", UseShellExecute = false }); p.WaitForExit(); return p.ExitCode; } }`;
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
    await page.evaluate(async () => {
      await window.multiCliWork.workbench.saveLaunchProfile({ id: "probe", name: "Probe", agentId: "codex", model: "codex-probe", effort: "high" });
      await window.multiCliWork.workbench.setDefaultLaunchProfile("codex", "probe");
    });
    await page.getByRole("button", { name: "Codex Chips 폴더 선택" }).click();
    await page.getByRole("button", { name: "새 Codex 세션", exact: true }).first().click();
    await expect.poll(() => page.evaluate(async () => (await window.multiCliWork.terminals.list()).length)).toBe(1);
    const session = await page.evaluate(async () => (await window.multiCliWork.terminals.list())[0]);
    await expect.poll(() => page.evaluate(async (id) => (await window.multiCliWork.terminals.attach(id)).replay, session.id)).toContain("HOOKS_READY");
    const initialArgs = await fs.readFile(path.join(root, `argv-${session.id}.txt`), "utf8");
    expect(initialArgs).toContain("--model=codex-probe");
    expect(initialArgs).toContain('model_reasoning_effort="high"');
    await expect(page.getByTestId("pane-chip").filter({ hasText: "codex-probe" })).toHaveCount(1);
    await expect(page.getByTestId("pane-chip").filter({ hasText: "계획" })).toHaveCount(1);
    await expect(page.getByTestId("pane-chip").filter({ hasText: "Bash" })).toHaveCount(1);
    const queued = await page.evaluate(async id => window.multiCliWork.deliveries.send(id, "Original review request"), session.id);
    expect(queued).toMatchObject({ state: "held", projectId });
    await page.evaluate(async id => window.multiCliWork.deliveries.edit(id, "Revised review request"), queued.id);
    await expect.poll(() => page.evaluate(async ({ projectId, deliveryId }) => {
      const entries = await window.multiCliWork.board.list(projectId);
      return entries.find(entry => entry.to.some(recipient => recipient.deliveryId === deliveryId));
    }, { projectId, deliveryId: queued.id })).toMatchObject({ text: "Original review request", author: { kind: "user" }, to: [{ deliveryText: "Revised review request" }] });
    await page.getByRole("tab", { name: "기록", exact: true }).click();
    await expect(page.getByRole("region", { name: "폴더 기록" })).toContainText("Original review request");
    await page.getByRole("button", { name: "상세 활동 펼치기" }).click();
    await expect(page.getByRole("region", { name: "세션 활동 및 정보" })).toContainText("도구 시작 · Bash");
    await page.evaluate(async id => window.multiCliWork.deliveries.drop(id), queued.id);
    await page.getByRole("tab", { name: "파일", exact: true }).click();
    await fs.writeFile(path.join(root, "phase"), "stop");
    await expect.poll(() => page.evaluate(async (id) => (await window.multiCliWork.terminals.list()).find((item) => item.id === id)?.status, session.id)).toBe("awaiting-input");
    await expect(page.getByTestId("pane-chip").filter({ hasText: "Bash" })).toHaveCount(0);
    await page.evaluate(async id => window.multiCliWork.terminals.rename(id, "Parent"), session.id);
    await page.getByRole("button", { name: /Parent 패인 열기/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "대화 분기…", exact: true }).click();
    const fork = page.getByRole("dialog", { name: "대화 분기", exact: true });
    await fork.getByLabel("새 세션 이름").fill("Fork child");
    await fork.getByRole("button", { name: "새 대화로 분기" }).click();
    await expect(fork).toBeHidden();
    await expect.poll(() => page.evaluate(async () => (await window.multiCliWork.terminals.list()).length)).toBe(2);
    await expect.poll(() => page.evaluate(async () => (await window.multiCliWork.terminals.list()).find(item => item.name === "Fork child")?.providerConversationId)).toMatch(/^codex-/);
    const child = await page.evaluate(async () => (await window.multiCliWork.terminals.list()).find(item => item.name === "Fork child")!);
    expect(child.providerConversationId).not.toBe(`codex-${session.id}`);
    const forkArgs = await fs.readFile(path.join(root, `argv-${child.id}.txt`), "utf8");
    expect(forkArgs.split(/\r?\n/)).toContain("fork");
    expect(forkArgs).not.toContain("--model=codex-probe");
    expect(await page.evaluate(async id => (await window.multiCliWork.terminals.list()).find(item => item.id === id)?.providerConversationId, session.id)).toBe(`codex-${session.id}`);
    await expect.poll(() => page.evaluate(async id => (await window.multiCliWork.workbench.state()).state.forks?.[id], child.id)).toBe(session.id);
    await expect.poll(() => page.evaluate(async () => (await window.multiCliWork.activity.list()).some(event => event.event === "PreToolUse" && event.toolName === "Bash"))).toBe(true);
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }).catch(() => undefined);
    await app.close();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
