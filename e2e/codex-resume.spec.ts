import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test.skip(process.platform !== "win32", "Windows Codex launcher");

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "01a10c79-b290-7af0-9e7c-23294236d4f1";

for (const footer of [true, false]) {
  test(`Codex resume button ${footer ? "recovers the saved exit id" : "opens the native conversation picker"} without a SessionStart hook`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-resume-e2e-"));
    const userData = path.join(root, "user-data");
    const bin = path.join(root, "bin");
    const now = new Date().toISOString();
    await fs.mkdir(path.join(userData, "session-logs"), { recursive: true });
    await fs.mkdir(bin);
    await fs.writeFile(path.join(root, "projects.json"), JSON.stringify({ schemaVersion: 1, updatedAt: now, projects: {
      [PROJECT_ID]: { id: PROJECT_ID, rootPath: root, displayName: "Resume Test", sources: ["manual"],
        providerRefs: { claude: [], codex: [] }, status: null, memo: "", tracks: [], hidden: false,
        order: 0, createdAt: now, updatedAt: now },
    } }));
    await fs.writeFile(path.join(userData, "state.json"), JSON.stringify({ schemaVersion: 1, updatedAt: now,
      selectedProjectId: PROJECT_ID, selectedSessionId: SESSION_ID, sessions: {
        [SESSION_ID]: { id: SESSION_ID, projectId: PROJECT_ID, tool: null, kind: "codex", cwd: root,
          title: null, name: null, providerConversationId: null, interruptedByShutdown: false,
          createdAt: now, updatedAt: now },
      }, folderViews: { [PROJECT_ID]: { layoutId: "single", slots: [SESSION_ID] } },
    }));
    if (footer) await fs.writeFile(path.join(userData, "session-logs", `${SESSION_ID}.log`),
      `\r\nSession ID: ${CONVERSATION_ID}\r\n`);
    // The real UI, IPC, PTY, persistence and launch arguments run; only the Codex TUI is simulated.
    await fs.writeFile(path.join(bin, "fake.cjs"), `
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex test'); process.exit(0); }
fs.writeFileSync(${JSON.stringify(path.join(root, "launch.json"))}, JSON.stringify(args));
console.log(args.includes(${JSON.stringify(CONVERSATION_ID)}) ? 'EXACT_CONVERSATION_RESUMED' : 'CODEX_RESUME_PICKER');
process.stdin.resume();
`);
    await fs.writeFile(path.join(bin, "codex.cmd"), `@echo off\r\n"${process.execPath}" "%~dp0fake.cjs" %*\r\n`);
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"));
    const app = await electron.launch({ args: [path.resolve("out/main/index.js")], env: {
      ...inherited, Path: `${bin};${process.env.Path ?? process.env.PATH}`, CODEX_HOME: path.join(root, "codex-home"),
      MULTI_CLI_WORK_USER_DATA: userData, MULTI_CLI_WORK_REGISTRY_PATH: path.join(root, "projects.json"),
      MULTI_CLI_WORK_AGENTS_PATH: path.join(root, "agents.json"), MULTI_CLI_WORK_WORK_PROJECTS_PATH: path.join(root, "work-projects.json"),
      MULTI_CLI_WORK_WORKTREES_PATH: path.join(root, "worktrees.json"), MULTI_CLI_WORK_PR_REVIEWS_PATH: path.join(root, "reviews.json"),
      MULTI_CLI_WORK_WORKSPACE_PATH: path.join(root, "workspace.json"), MULTI_CLI_WORK_PROJECT_TAGS_PATH: path.join(root, "tags.json"),
    } });
    try {
      const page = await app.firstWindow();
      await page.getByRole("button", { name: "Resume Test 폴더 선택" }).click();
      await page.getByRole("button", { name: "세션 재개" }).click();
      await expect.poll(async () => page.evaluate(async (id) => (await window.multiCliWork.terminals.attach(id)).replay, SESSION_ID))
        .toContain(footer ? "EXACT_CONVERSATION_RESUMED" : "CODEX_RESUME_PICKER");
      const args: string[] = JSON.parse(await fs.readFile(path.join(root, "launch.json"), "utf8"));
      expect(args.slice(0, footer ? 6 : 5)).toEqual(footer
        ? ["--profile", "multi-cli-work", "resume", CONVERSATION_ID, "-C", root]
        : ["--profile", "multi-cli-work", "resume", "-C", root]);
      expect(args).not.toContain("--last");
      const session = await page.evaluate(async (id) => (await window.multiCliWork.terminals.list()).find((entry) => entry.id === id), SESSION_ID);
      expect(session?.providerConversationId).toBe(footer ? CONVERSATION_ID : null);
      await expect(page.getByRole("button", { name: "세션 중지" })).toBeVisible();
    } finally {
      await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }).catch(() => undefined);
      await app.close();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
}
