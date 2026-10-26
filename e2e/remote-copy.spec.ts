import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

/** 원격 창 터미널에서 마우스로 끌어 고른 여러 줄이 Ctrl+C로 통째로 복사되는지. */
const execFileAsync = promisify(execFile);
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-07-11T12:00:00.000Z";
const SHELL_LABEL = process.platform === "win32" ? "PowerShell" : "Bash";

let tempRoot: string;
let app: ElectronApplication;
let page: Page;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const found = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(found));
    });
  });
}

test.describe.serial("Remote window copy", () => {
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "multi-cli-work-remote-visual-"));
    const port = await freePort();
    const projectRoot = path.join(tempRoot, "sample-project");
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(path.join(tempRoot, "registry"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "user-data"), { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: projectRoot });
    await fs.writeFile(path.join(projectRoot, "readme.md"), "sample\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: projectRoot });
    await execFileAsync("git", ["-c", "user.email=e2e@example.com", "-c", "user.name=E2E", "commit", "-m", "init"], { cwd: projectRoot });
    await execFileAsync("git", ["-C", projectRoot, "worktree", "add", "-b", "feat/remote", path.join(tempRoot, "remote-worktree")]);
    await fs.writeFile(
      path.join(tempRoot, "registry", "projects.json"),
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: NOW,
        projects: {
          [PROJECT_ID]: {
            id: PROJECT_ID, rootPath: projectRoot, displayName: "Sample Project", sources: ["manual"],
            providerRefs: { claude: [], codex: [] }, status: "진행중", memo: "", tracks: [], hidden: false, order: 0,
            createdAt: NOW, updatedAt: NOW,
          },
        },
      }),
      "utf8",
    );
    await fs.writeFile(path.join(tempRoot, "user-data", "settings.json"), JSON.stringify({ remote: { enabled: true, port } }), "utf8");
    const registry = (name: string) => path.join(tempRoot, "registry", name);
    app = await electron.launch({
      args: [path.resolve("out/main/index.js")],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
        MULTI_CLI_WORK_USER_DATA: path.join(tempRoot, "user-data"),
        MULTI_CLI_WORK_REGISTRY_PATH: registry("projects.json"),
        MULTI_CLI_WORK_CODEX_SESSIONS_DIR: path.join(tempRoot, "codex-sessions"),
        MULTI_CLI_WORK_AGENTS_PATH: registry("agents.json"),
        MULTI_CLI_WORK_WORK_PROJECTS_PATH: registry("work-projects.json"),
        MULTI_CLI_WORK_WORKTREES_PATH: registry("worktrees.json"),
        MULTI_CLI_WORK_WORKTREE_SCRIPTS_PATH: registry("worktree-scripts.json"),
        MULTI_CLI_WORK_CLAUDE_CONFIG_DIR: path.join(tempRoot, "claude-config"),
        MULTI_CLI_WORK_PR_REVIEWS_PATH: registry("pr-reviews.json"),
        MULTI_CLI_WORK_WORKSPACE_PATH: registry("workspace.json"),
        MULTI_CLI_WORK_PROJECT_TAGS_PATH: registry("project-tags.json"),
        MULTI_CLI_WORK_REMOTE_BIND: "127.0.0.1",
      },
    });
    page = await app.firstWindow();
    await app.evaluate(({ safeStorage }) => {
      (safeStorage as unknown as { setUsePlainTextEncryption?: (use: boolean) => void }).setUsePlainTextEncryption?.(true);
    });
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.unmaximize();
      window?.setContentSize(1440, 900);
    });
    void port;
  });

  test.afterAll(async () => {
    await app?.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    }).catch(() => undefined);
    await app?.close().catch(() => undefined);
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  test("copies a multi-line mouse selection with Ctrl+C", async () => {
    await expect(page.getByRole("heading", { name: "멀티 터미널 작업기" })).toBeVisible();
    await page.getByRole("button", { name: "Sample Project 폴더 선택" }).click();
    await page.getByRole("button", { name: `새 ${SHELL_LABEL} 세션` }).first().click();
    await expect.poll(() => page.evaluate(() => window.multiCliWork.remote.status().then((status) => status.state))).toBe("listening");
    const settings = JSON.parse(await fs.readFile(path.join(tempRoot, "user-data", "settings.json"), "utf8"));
    const pairing = await page.evaluate(() => window.multiCliWork.remote.issuePairingCode());
    const added = await page.evaluate(
      (input) => window.multiCliWork.remoteHosts.add(input),
      { address: `127.0.0.1:${settings.remote.port}`, code: pairing.code },
    );
    const remotePromise = app.waitForEvent("window");
    await page.getByRole("region", { name: "원격 PC" }).getByRole("button", { name: added.name }).click();
    const remote = await remotePromise;
    await remote.setViewportSize({ width: 1280, height: 800 });

    const copied = async (terminal: Locator) => {
      const rows = terminal.locator(".xterm-rows");
      const from = (await rows.locator("> div", { hasText: /^COPY_ONE/ }).boundingBox())!;
      const to = (await rows.locator("> div", { hasText: /^COPY_THREE/ }).boundingBox())!;
      await remote.mouse.move(from.x + 2, from.y + from.height / 2);
      await remote.mouse.down();
      await remote.mouse.move(to.x + to.width - 2, to.y + to.height / 2, { steps: 12 });
      await remote.mouse.up();
      // 사람처럼 잠깐 뒤에 누른다 — 끌기 뒤에 오는 포커스·크기 변경이 고른 것을 지우는지까지 본다.
      await remote.waitForTimeout(1_000);
      await app.evaluate(({ clipboard }) => clipboard.writeText(""));
      await remote.keyboard.press("Control+c");
      await expect
        .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
        .toMatch(/COPY_ONE\s+COPY_TWO\s+COPY_THREE/);
    };

    const terminals = remote.getByRole("region", { name: /터미널$/ });
    const first = terminals.first();
    await first.click();
    const command = process.platform === "win32"
      ? "Write-Output COPY_ONE COPY_TWO COPY_THREE"
      : "printf 'COPY_ONE\\nCOPY_TWO\\nCOPY_THREE\\n'";
    await remote.keyboard.type(command);
    await remote.keyboard.press("Enter");
    await expect(first.locator(".xterm-rows")).toContainText("COPY_THREE");

    // 포커스 칸.
    await copied(first);

    // 포커스가 다른 칸에 있을 때 — 줄여 그린 칸에서 바로 끌어 고른다.
    await page.getByRole("button", { name: `새 ${SHELL_LABEL} 세션` }).first().click();
    await expect(terminals).toHaveCount(2);
    await terminals.nth(1).click();
    await expect(remote.locator(".m-pane-focused").getByRole("region", { name: /터미널$/ })).toHaveCount(1);
    await expect(terminals.nth(1).locator("xpath=ancestor::main[1]")).toHaveClass(/m-pane-focused/);
    await expect(first.locator(".xterm")).toHaveAttribute("style", /scale\(/);
    await copied(first);
    // 고른 것을 지우지 않게 포커스는 옮기지 않았다.
    await expect(first.locator(".xterm")).toHaveAttribute("style", /scale\(/);
  });
});
