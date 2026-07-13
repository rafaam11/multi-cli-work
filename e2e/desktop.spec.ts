import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-07-11T12:00:00.000Z";

let tempRoot: string;
let app: ElectronApplication;
let page: Page;

async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const packagedExecutable = process.env.MULTI_CLI_WORK_E2E_EXECUTABLE;
  const nextApp = await electron.launch({
    ...(packagedExecutable ? { executablePath: packagedExecutable, args: [] } : { args: [path.resolve("out/main/index.js")] }),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      MULTI_CLI_WORK_USER_DATA: path.join(tempRoot, "user-data"),
      MULTI_CLI_WORK_REGISTRY_PATH: path.join(tempRoot, "registry", "projects.json"),
      MULTI_CLI_WORK_CODEX_SESSIONS_DIR: path.join(tempRoot, "codex-sessions"),
      MULTI_CLI_WORK_AGENTS_PATH: path.join(tempRoot, "registry", "agents.json"),
      MULTI_CLI_WORK_WORKTREES_PATH: path.join(tempRoot, "registry", "worktrees.json"),
    },
  });
  return { app: nextApp, page: await nextApp.firstWindow() };
}

async function attachScreenshot(name: string): Promise<void> {
  const screenshotPath = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path: screenshotPath });
  await test.info().attach(name, { path: screenshotPath, contentType: "image/png" });
}

test.describe.serial("Multi CLI Work desktop", () => {
  test.beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "multi-cli-work-e2e-"));
    const projectRoot = path.join(tempRoot, "sample-project");
    await Promise.all([
      fs.mkdir(projectRoot, { recursive: true }),
      fs.mkdir(path.join(tempRoot, "registry"), { recursive: true }),
      fs.mkdir(path.join(tempRoot, "codex-sessions"), { recursive: true }),
    ]);
    // A real repo with one commit, so the worktree flow runs against actual git.
    await execFileAsync("git", ["init", "-b", "main"], { cwd: projectRoot });
    await fs.writeFile(path.join(projectRoot, "readme.md"), "sample\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: projectRoot });
    await execFileAsync(
      "git",
      ["-c", "user.email=e2e@example.com", "-c", "user.name=E2E", "commit", "-m", "init"],
      { cwd: projectRoot },
    );
    await fs.writeFile(
      path.join(tempRoot, "registry", "projects.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          updatedAt: NOW,
          projects: {
            [PROJECT_ID]: {
              id: PROJECT_ID,
              rootPath: projectRoot,
              displayName: "Sample Project",
              sources: ["manual"],
              providerRefs: { claude: [], codex: [] },
              status: "진행중",
              memo: "",
              tracks: [],
              hidden: false,
              order: 0,
              createdAt: NOW,
              updatedAt: NOW,
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    // A CLI the app has never heard of, described only by data. It runs PowerShell under a name of
    // its own so the session is real without the test depending on a third-party CLI being installed.
    await fs.writeFile(
      path.join(tempRoot, "registry", "agents.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          updatedAt: NOW,
          agents: {
            "echo-agent": {
              id: "echo-agent",
              label: "Echo Agent",
              commands: ["powershell"],
              args: ["-NoLogo", "-NoExit", "-Command", "Write-Output MCW_CUSTOM_AGENT_READY"],
              conversationId: "none",
              statusAdapter: "signals",
              accentColor: "#4285f4",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    ({ app, page } = await launchApp());
  });

  test.afterAll(async () => {
    await app?.close().catch(() => undefined);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  test("runs a real PowerShell PTY and remains framed at both supported window sizes", async () => {
    await expect(page.getByRole("heading", { name: "멀티 터미널 작업기" })).toBeVisible();
    await page.getByRole("button", { name: "Sample Project 폴더 선택" }).click();
    await page.getByRole("button", { name: "새 PowerShell 세션" }).click();
    // The launchers stay exposed after the folder has a session.
    await expect(page.getByRole("button", { name: "새 Claude Code 세션" })).toBeVisible();

    const terminal = page.getByRole("region", { name: "powershell 터미널" });
    await expect(terminal).toBeVisible();
    await terminal.click();
    await page.keyboard.type("Write-Output MCW_PTY_READY");
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText("MCW_PTY_READY");
    await attachScreenshot("desktop-1280x820");

    await page.setViewportSize({ width: 900, height: 600 });
    await expect
      .poll(() => page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })))
      .toMatchObject({ width: 900, height: 600 });
    const bounds = await page.locator(".app-shell, .project-sidebar, .workspace-header, .terminal-surface").evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      }),
    );
    for (const bound of bounds) {
      expect(bound.left).toBeGreaterThanOrEqual(0);
      expect(bound.top).toBeGreaterThanOrEqual(0);
      expect(bound.right).toBeLessThanOrEqual(900);
      expect(bound.bottom).toBeLessThanOrEqual(600);
    }
    await attachScreenshot("compact-900x600");

    await page.evaluate(() => {
      const state = window as typeof window & {
        __multiCliWorkE2eOutput?: string;
        __multiCliWorkE2eUnsubscribe?: () => void;
      };
      state.__multiCliWorkE2eOutput = "";
      state.__multiCliWorkE2eUnsubscribe = window.multiCliWork.terminals.onEvent((event) => {
        if (event.type === "data") state.__multiCliWorkE2eOutput += event.data;
      });
    });
    await terminal.click();
    await page.keyboard.type(
      "[Console]::Write(([char]27).ToString() + '[32mMCW_ANSI_GREEN' + ([char]27).ToString() + '[0m' + [Environment]::NewLine); " +
        "[Console]::Write(([char]27).ToString() + ']9;MCW_OSC_SIGNAL' + ([char]7).ToString()); " +
        "1..250 | ForEach-Object { 'MCW_BURST_' + $_ }; exit 7",
    );
    await page.keyboard.press("Enter");

    await expect(page.locator(".xterm-rows")).toContainText("MCW_ANSI_GREEN");
    await expect(page.locator(".xterm-rows")).toContainText("MCW_BURST_250");
    await expect(page.locator(".active-status")).toHaveText("종료됨");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { __multiCliWorkE2eOutput?: string })
              .__multiCliWorkE2eOutput,
        ),
      )
      .toContain("\u001b]9;MCW_OSC_SIGNAL\u0007");
    await page.evaluate(() => {
      const state = window as typeof window & { __multiCliWorkE2eUnsubscribe?: () => void };
      state.__multiCliWorkE2eUnsubscribe?.();
    });
  });

  test("shows the home dashboard from the logo and the project detail page from the folder", async () => {
    await page.getByRole("button", { name: "홈 대시보드 열기" }).click();
    await expect(page.getByRole("region", { name: "홈 대시보드" })).toBeVisible();
    await expect(page.getByRole("region", { name: "세션 모니터" })).toBeVisible();

    await page.getByRole("button", { name: "Sample Project 폴더 선택" }).click();
    await expect(page.getByRole("region", { name: "프로젝트 상세" })).toBeVisible();
    await expect(page.getByRole("button", { name: "PowerShell 세션 보기" })).toBeVisible();
  });

  /**
   * The whole point of the agent registry: a CLI the app ships no code for is launchable purely from
   * `agents.json`, and it stands next to the built-ins rather than behind them.
   */
  test("runs an agent the user added in agents.json", async () => {
    await page.getByRole("button", { name: "Sample Project 폴더 선택" }).click();
    await expect(page.getByRole("button", { name: "새 PowerShell 세션" })).toBeVisible();

    await page.getByRole("button", { name: "새 Echo Agent 세션" }).click();

    const terminal = page.getByRole("region", { name: "echo-agent 터미널" });
    await expect(terminal).toBeVisible();
    await expect(page.locator(".xterm-rows")).toContainText("MCW_CUSTOM_AGENT_READY");
    await expect(page.getByRole("button", { name: "Echo Agent 세션 열기" })).toBeVisible();
    await attachScreenshot("custom-agent");

    // The row grows with every agent the user adds, so at the narrowest supported window it has to
    // scroll rather than clip — otherwise the agent they just added is the one they cannot reach.
    const launcherRow = page.locator(".launcher-row");
    const overflow = await launcherRow.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollable: getComputedStyle(element).overflowX,
    }));
    expect(overflow.scrollable).toBe("auto");
    if (overflow.scrollWidth > overflow.clientWidth) {
      await launcherRow.evaluate((element) => element.scrollTo({ left: element.scrollWidth }));
      const lastButton = launcherRow.getByRole("button", { name: "새 Echo Agent 세션" });
      await expect(lastButton).toBeInViewport();
    }
  });

  test("jumps between sessions with the quick open palette", async () => {
    // Focus sits inside the Echo Agent terminal from the previous test — the palette shortcut
    // must win over the terminal, which is the whole point of the capture-phase listener.
    await page.keyboard.press("Control+p");
    const palette = page.getByRole("dialog", { name: "빠른 열기" });
    await expect(palette).toBeVisible();

    await page.keyboard.type("power");
    await page.keyboard.press("Enter");
    await expect(palette).toBeHidden();
    await expect(page.getByRole("region", { name: "powershell 터미널" })).toBeVisible();

    await page.keyboard.press("Control+p");
    await expect(palette).toBeVisible();
    await attachScreenshot("quick-open");
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  });

  /**
   * The Orca-style parallel loop end to end: an isolated worktree, a session running inside it,
   * one prompt fanned out to every live session, the diff of what happened, and a removal that
   * refuses to discard uncommitted work until forced explicitly.
   */
  test("runs a worktree session, fans out a prompt, and guards worktree removal", async () => {
    await page.getByRole("button", { name: "Sample Project 폴더 선택" }).click({ button: "right" });
    await page.getByRole("menu", { name: "Sample Project 작업" }).getByRole("menuitem", { name: "Worktree 만들기" }).click();
    const createDialog = page.getByRole("dialog", { name: "Worktree 만들기" });
    await createDialog.getByRole("textbox", { name: "브랜치 이름" }).fill("feature/e2e");
    await createDialog.getByRole("button", { name: "만들기" }).click();

    // The new worktree opens scoped; a session started here runs in the worktree directory.
    await expect(page.getByRole("button", { name: "feature/e2e worktree 선택" })).toBeVisible();
    await page.getByRole("button", { name: "새 PowerShell 세션" }).click();
    const terminal = page.getByRole("region", { name: "powershell 터미널" });
    await expect(terminal).toBeVisible();
    await terminal.click();
    await page.keyboard.type('Write-Output ("MCW_PWD_" + $PWD.Path)');
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText("sample-project-wt");
    await attachScreenshot("worktree-session");

    // Fan one prompt out to every live session of the project (worktree + Echo Agent).
    await page.getByRole("button", { name: "Sample Project 폴더 선택" }).click();
    await page.getByRole("button", { name: "프롬프트 팬아웃" }).click();
    const fanOut = page.getByRole("dialog", { name: "프롬프트 팬아웃" });
    await expect(fanOut.getByRole("checkbox")).toHaveCount(2);
    await fanOut.getByRole("textbox", { name: "팬아웃 프롬프트" }).fill("Write-Output MCW_FANOUT_OK");
    await attachScreenshot("fan-out");
    await fanOut.getByRole("button", { name: "2개 세션에 전송" }).click();
    await expect(fanOut).toBeHidden();
    await page.getByRole("button", { name: "PowerShell 2 세션 열기" }).click();
    await expect(page.locator(".xterm-rows")).toContainText("MCW_FANOUT_OK");
    await page.getByRole("button", { name: "Echo Agent 세션 열기" }).click();
    await expect(page.locator(".xterm-rows")).toContainText("MCW_FANOUT_OK");

    // Leave an uncommitted file in the worktree, then read it back from the diff view.
    await page.getByRole("button", { name: "PowerShell 2 세션 열기" }).click();
    await page.locator(".terminal-surface").click();
    // The marker is concatenated so it appears in the command's OUTPUT only — the echoed input
    // line must not satisfy the wait, or the diff races the file write.
    await page.keyboard.type('Set-Content -Path wip.txt -Value MCW_DIRTY; Write-Output ("MCW_WROTE_" + "DONE")');
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText("MCW_WROTE_DONE");
    await page.getByRole("button", { name: "feature/e2e worktree 선택" }).click({ button: "right" });
    await page.getByRole("menu", { name: "feature/e2e worktree 작업" }).getByRole("menuitem", { name: "변경 보기" }).click();
    const diff = page.getByRole("dialog", { name: "변경 보기" });
    await expect(diff).toContainText("wip.txt");
    await attachScreenshot("worktree-diff");
    await diff.getByRole("button", { name: "변경 보기 닫기" }).click();

    // Removal refuses over the uncommitted file until the explicit force confirmation.
    await page.getByRole("button", { name: "feature/e2e worktree 선택" }).click({ button: "right" });
    await page.getByRole("menu", { name: "feature/e2e worktree 작업" }).getByRole("menuitem", { name: "Worktree 제거" }).click();
    const confirm = page.getByRole("dialog", { name: "Worktree 제거" });
    await expect(confirm).toContainText("세션 1개");
    await confirm.getByRole("button", { name: "제거" }).click();
    const force = page.getByRole("dialog", { name: "Worktree 강제 제거" });
    await expect(force).toContainText("커밋되지 않은 변경");
    await attachScreenshot("worktree-force-remove");
    await force.getByRole("button", { name: "변경을 버리고 강제 제거" }).click();
    await expect(page.getByRole("button", { name: "feature/e2e worktree 선택" })).toBeHidden();
    expect(
      await fs.stat(path.join(tempRoot, "sample-project-wt", "feature-e2e")).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  });

  test("hides to the tray and restores saved tabs after a relaunch", async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(false);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(true);

    await app.close();
    ({ app, page } = await launchApp());

    await expect(page.getByRole("button", { name: "PowerShell 세션 열기" })).toBeVisible();
    await page.getByRole("button", { name: "PowerShell 세션 열기" }).click();
    await expect(page.getByRole("button", { name: "세션 재개" })).toBeVisible();
  });

  test("splits the workspace into two independent live terminals", async () => {
    // Both sessions exited with the relaunch; resume each so both panes are interactive.
    await page.getByRole("button", { name: "Echo Agent 세션 열기" }).click();
    await page.getByRole("button", { name: "세션 재개" }).click();
    await expect(page.locator(".active-status")).not.toHaveText("종료됨");
    await page.getByRole("button", { name: "PowerShell 세션 열기" }).click();
    await page.getByRole("button", { name: "세션 재개" }).click();
    await expect(page.locator(".active-status")).not.toHaveText("종료됨");

    await page.getByRole("button", { name: "화면 분할" }).click();
    await page.getByRole("menuitem", { name: "Echo Agent" }).click();

    const left = page.locator(".split-primary");
    const right = page.locator(".split-secondary");
    await expect(left.getByRole("region", { name: "powershell 터미널" })).toBeVisible();
    await expect(right.getByRole("region", { name: "echo-agent 터미널" })).toBeVisible();

    // Input typed into one pane must never leak into the other.
    await left.locator(".terminal-surface").click();
    await page.keyboard.type("Write-Output MCW_SPLIT_LEFT");
    await page.keyboard.press("Enter");
    await expect(left.locator(".xterm-rows")).toContainText("MCW_SPLIT_LEFT");
    await expect(right.locator(".xterm-rows")).not.toContainText("MCW_SPLIT_LEFT");

    await right.locator(".terminal-surface").click();
    await page.keyboard.type("Write-Output MCW_SPLIT_RIGHT");
    await page.keyboard.press("Enter");
    await expect(right.locator(".xterm-rows")).toContainText("MCW_SPLIT_RIGHT");
    await expect(left.locator(".xterm-rows")).not.toContainText("MCW_SPLIT_RIGHT");
    await attachScreenshot("workspace-split");

    await page.getByRole("button", { name: "분할 닫기" }).click();
    await expect(page.locator(".split-secondary")).toBeHidden();
  });

  test("removes a folder from the list through the context menu without deleting it from disk", async () => {
    const projectRoot = path.join(tempRoot, "sample-project");
    await page.getByRole("button", { name: "Sample Project 폴더 선택" }).click({ button: "right" });

    const menu = page.getByRole("menu", { name: "Sample Project 작업" });
    await expect(menu.getByRole("menuitem", { name: "파일 탐색기에서 열기" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "목록에서 제거" }).click();

    const confirm = page.getByRole("dialog", { name: "목록에서 폴더 제거" });
    await expect(confirm).toContainText("중지되고");
    await confirm.getByRole("button", { name: "제거" }).click();

    await expect(page.getByRole("button", { name: "Sample Project 폴더 선택" })).toBeHidden();
    await expect(page.getByText("아직 폴더가 없습니다")).toBeVisible();
    expect((await fs.stat(projectRoot)).isDirectory()).toBe(true);

    const savedRegistry = JSON.parse(await fs.readFile(path.join(tempRoot, "registry", "projects.json"), "utf8"));
    expect(savedRegistry.projects).toEqual({});
  });
});
