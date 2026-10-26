import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

/**
 * 진단용: 호스트 메인 창과 원격 창을 같은 상태로 두고 양쪽 스크린숏을 남긴다.
 * 기본 실행에서는 건너뛴다 — `MCW_VISUAL_DIR=<폴더> npx playwright test remote-visual`로 돌린다.
 */
const SHOT_DIR = process.env.MCW_VISUAL_DIR;
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

test.describe.serial("Remote window visuals", () => {
  test.skip(!SHOT_DIR, "MCW_VISUAL_DIR가 없으면 건너뛴다");
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "multi-cli-work-remote-visual-"));
    const port = await freePort();
    const projectRoot = path.join(tempRoot, "sample-project");
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(path.join(tempRoot, "registry"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "user-data"), { recursive: true });
    await fs.mkdir(SHOT_DIR!, { recursive: true });
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

  test("captures host and remote side by side", async () => {
    await expect(page.getByRole("heading", { name: "멀티 터미널 작업기" })).toBeVisible();
    await page.getByRole("button", { name: "Sample Project 폴더 선택" }).click();
    const newShell = page.getByRole("button", { name: `새 ${SHELL_LABEL} 세션` }).first();
    await newShell.click();
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

    const shot = async (name: string) => {
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(SHOT_DIR!, `${name}-host.png`) });
      await remote.screenshot({ path: path.join(SHOT_DIR!, `${name}-remote.png`) });
    };

    await shot("01-one-session");
    await newShell.click();
    await newShell.click();
    await expect(page.locator(".grid-pane")).toHaveCount(3);
    await shot("02-three-auto");

    await page.locator(".layout-bar").getByRole("radio", { name: "2열", exact: true }).click();
    await shot("03-three-2col");

    await newShell.click();
    await newShell.click();
    await page.locator(".layout-bar").getByRole("radio", { name: "자동" }).click();
    await shot("04-five-auto");

    await page.locator(".layout-bar").getByRole("radio", { name: "3열", exact: true }).click();
    await page.locator(".grid-pane").first().getByRole("button", { name: "열 세로분할" }).click();
    await shot("05-split");

    await page.locator(".grid-pane").first().getByRole("button", { name: "패인 확대" }).click();
    await shot("06-zoom");
    await page.locator(".grid-pane").first().getByRole("button", { name: "확대 해제" }).click();

    await page.locator(".layout-bar").getByRole("radio", { name: "6열", exact: true }).click().catch(() => undefined);
    await shot("07-empty-slots");

    await remote.setViewportSize({ width: 1000, height: 700 });
    await shot("08-small-remote");
    await remote.setViewportSize({ width: 860, height: 640 });
    await shot("09-narrow-remote");

    // 원격에서 바꾼 것이 호스트에 닿는지: 레이아웃, 확대.
    await remote.setViewportSize({ width: 1280, height: 800 });
    const mirror = remote.getByRole("region", { name: "호스트 화면" });
    await mirror.getByRole("radiogroup", { name: "레이아웃 선택" }).getByRole("radio", { name: "2열", exact: true }).click();
    await expect(page.locator(".workspace-grid")).toHaveAttribute("data-layout", "cols:1-1");
    await shot("10-remote-layout");
    await mirror.getByRole("button", { name: "패인 확대" }).first().click();
    await expect(page.locator(".workspace-grid")).toHaveAttribute("data-zoomed", "true");
    await shot("11-remote-zoom");
    await mirror.getByRole("button", { name: "확대 해제" }).click();
    await expect(page.locator(".workspace-grid")).not.toHaveAttribute("data-zoomed", "true");
  });
});
