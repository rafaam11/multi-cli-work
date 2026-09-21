import { _electron as electron, expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
test.skip(process.platform !== "win32", "PowerShell integration");

for (const provider of ["claude", "codex"] as const) {
  test(`${provider} inside PowerShell moves the same sidebar session with its worktree`, async ({}, testInfo) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-workspace-e2e-"));
    const repo = path.join(root, "repo");
    const tree = path.join(root, "feature");
    const userData = path.join(root, "user-data");
    const bin = path.join(root, "bin");
    const projectId = "11111111-1111-4111-8111-111111111111";
    const now = new Date().toISOString();
    await fs.mkdir(repo, { recursive: true });
    await fs.mkdir(bin);
    await exec("git", ["init", "-b", "main"], { cwd: repo });
    await exec("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "init"], { cwd: repo });
    await fs.writeFile(path.join(root, "projects.json"), JSON.stringify({ schemaVersion: 1, updatedAt: now, projects: {
      [projectId]: { id: projectId, rootPath: repo, displayName: "Workspace Test", sources: ["manual"], providerRefs: { claude: [], codex: [] }, status: null, memo: "", tracks: [], hidden: false, order: 0, createdAt: now, updatedAt: now },
    } }));
    // Only the model is simulated: the shell, generated hooks, Git worktree, IPC and UI are real.
    await fs.writeFile(path.join(bin, "fake.cjs"), `
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = ${JSON.stringify(root)}, repo = ${JSON.stringify(repo)}, tree = ${JSON.stringify(tree)};
const provider = ${JSON.stringify(provider)}, userData = ${JSON.stringify(userData)};
const argv = process.argv.slice(2);
if (argv.includes('--version')) { console.log('test cli'); process.exit(0); }
const transcript = path.join(root, 'transcript.jsonl');
function hook(event, cwd) {
  const payload = JSON.stringify({ hook_event_name: event, session_id: 'owned-conversation', cwd, transcript_path: transcript });
  if (provider === 'claude') {
    const settings = JSON.parse(fs.readFileSync(argv[argv.indexOf('--settings') + 1], 'utf8'));
    const command = settings.hooks[event][0].hooks[0];
    cp.execFileSync(command.command, command.args, { input: payload, windowsHide: true });
  } else {
    if (!argv.includes('multi-cli-work')) throw Error('missing integration profile');
    cp.execFileSync(process.execPath, [path.join(userData, 'provider-hooks', 'codex-session-start.cjs')], { input: payload, windowsHide: true });
  }
}
fs.writeFileSync(transcript, JSON.stringify({ type: 'turn_context', payload: { cwd: repo } }) + '\\n');
hook('SessionStart', repo);
cp.execFileSync('git', ['worktree', 'add', '-b', 'feature', tree], { cwd: repo, windowsHide: true });
if (provider === 'claude') hook('PostToolUse', tree);
else fs.appendFileSync(transcript, JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'git status', workdir: tree }) } }) + '\\n');
console.log('WORKTREE_READY');
process.stdin.resume();
process.stdin.on('data', () => process.exit(0));
`);
    await fs.writeFile(path.join(bin, `${provider}.cmd`), `@echo off\r\n"${process.execPath}" "%~dp0fake.cjs" %*\r\n`);
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"));
    const app = await electron.launch({ args: [path.resolve("out/main/index.js")], env: {
      ...inherited, Path: `${bin};${process.env.Path ?? process.env.PATH}`, CODEX_HOME: path.join(root, "codex-home"),
      MULTI_CLI_WORK_USER_DATA: userData, MULTI_CLI_WORK_REGISTRY_PATH: path.join(root, "projects.json"),
      MULTI_CLI_WORK_AGENTS_PATH: path.join(root, "agents.json"), MULTI_CLI_WORK_WORK_PROJECTS_PATH: path.join(root, "work-projects.json"),
      MULTI_CLI_WORK_WORKTREES_PATH: path.join(root, "worktrees.json"), MULTI_CLI_WORK_PR_REVIEWS_PATH: path.join(root, "reviews.json"),
    } });
    try {
      const page = await app.firstWindow();
      await page.getByRole("button", { name: "Workspace Test 폴더 선택" }).click();
      const session = await page.evaluate(async (projectId) => window.multiCliWork.terminals.create({ projectId, kind: "powershell", cols: 100, rows: 30 }), projectId);
      await page.evaluate(({ id, provider }) => window.multiCliWork.terminals.write(id, `${provider}\r`), { id: session.id, provider });
      await expect.poll(async () => page.evaluate(async (id) => (await window.multiCliWork.terminals.list()).find((entry) => entry.id === id)?.worktreeId, session.id)).toBeTruthy();
      const changed = await page.evaluate(async (id) => (await window.multiCliWork.terminals.list()).find((entry) => entry.id === id)!, session.id);
      expect(changed.pid).toBe(session.pid);
      expect(changed.kind).toBe("powershell");
      expect(changed.cwd.replaceAll("\\", "/")).toBe(tree.replaceAll("\\", "/"));
      const treeNode = page.locator(".worktree-node").filter({ has: page.getByRole("button", { name: /feature.*선택/ }) });
      // Expand/select the worktree so its session row is visible.
      await page.getByRole("button", { name: /feature.*선택/ }).click();
      await expect(treeNode.getByRole("button", { name: /세션 열기/ })).toHaveCount(1);
      await expect(page.locator(".main-workspace-node").getByRole("button", { name: /세션 열기/ })).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`${provider}-workspace.png`) });
      await page.evaluate((id) => window.multiCliWork.terminals.write(id, "exit\r"), session.id);
      await expect.poll(async () => page.evaluate(async (id) => (await window.multiCliWork.terminals.list()).find((entry) => entry.id === id)?.worktreeId ?? null, session.id)).toBeNull();
      expect((await page.evaluate(async (id) => (await window.multiCliWork.terminals.list()).find((entry) => entry.id === id), session.id))?.pid).toBe(session.pid);
    } finally {
      await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }).catch(() => undefined);
      await app.close();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
}
