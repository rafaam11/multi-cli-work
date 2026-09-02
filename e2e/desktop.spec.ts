import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-07-11T12:00:00.000Z";
const WINDOWS = process.platform === "win32";
const SHELL_ID = WINDOWS ? "powershell" : "bash";
const SHELL_LABEL = WINDOWS ? "PowerShell" : "Bash";
const shellCommand = (windows: string, linux: string) => (WINDOWS ? windows : linux);

let tempRoot: string;
let app: ElectronApplication;
let page: Page;

async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const packagedExecutable = process.env.MULTI_CLI_WORK_E2E_EXECUTABLE;
  const fakePath = `${path.join(tempRoot, "fake-bin")}${path.delimiter}${process.env.Path ?? process.env.PATH ?? ""}`;
  const inheritedEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"));
  const nextApp = await electron.launch({
    ...(packagedExecutable ? { executablePath: packagedExecutable, args: [] } : { args: [path.resolve("out/main/index.js")] }),
    env: {
      ...inheritedEnvironment,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      MULTI_CLI_WORK_USER_DATA: path.join(tempRoot, "user-data"),
      MULTI_CLI_WORK_REGISTRY_PATH: path.join(tempRoot, "registry", "projects.json"),
      MULTI_CLI_WORK_CODEX_SESSIONS_DIR: path.join(tempRoot, "codex-sessions"),
      MULTI_CLI_WORK_AGENTS_PATH: path.join(tempRoot, "registry", "agents.json"),
      MULTI_CLI_WORK_WORK_PROJECTS_PATH: path.join(tempRoot, "registry", "work-projects.json"),
      MULTI_CLI_WORK_WORKTREES_PATH: path.join(tempRoot, "registry", "worktrees.json"),
      MULTI_CLI_WORK_PR_REVIEWS_PATH: path.join(tempRoot, "registry", "pr-reviews.json"),
      MULTI_CLI_WORK_GH_EXECUTABLE: process.execPath,
      MULTI_CLI_WORK_GH_SCRIPT: path.join(tempRoot, "fake-bin", "gh.js"),
      [WINDOWS ? "Path" : "PATH"]: fakePath,
    },
  });
  return { app: nextApp, page: await nextApp.firstWindow() };
}

/**
 * What the app opens at (`src/main/index.ts`), which is what every test that is not about window
 * size should run in. Playwright drives one window across the whole file, so a resize is a change
 * to every test after it unless it is put back.
 */
const DEFAULT_WINDOW = { width: 1280, height: 820 };

async function restoreDefaultWindowSize(): Promise<void> {
  await page.setViewportSize(DEFAULT_WINDOW);
  await expect
    .poll(() => page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })))
    .toMatchObject(DEFAULT_WINDOW);
}

async function attachScreenshot(name: string): Promise<void> {
  const screenshotPath = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path: screenshotPath });
  await test.info().attach(name, { path: screenshotPath, contentType: "image/png" });
}

async function computedFontSize(selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((element) => getComputedStyle(element).fontSize);
}

/** One pane of the terminal grid, addressed by the session label its header shows. */
const pane = (label: string) => page.locator(`.grid-pane[aria-label="${label}"]`);

/**
 * A session's row in the sidebar's 세션 패널. Every session has one whatever page its pane sits on —
 * or whether it has a pane at all — and the accessible name may carry an unread suffix after the
 * label, so the label is matched at the start of it.
 */
const paneRow = (label: string) => page.getByRole("button", { name: new RegExp(`^${label} 세션 열기`) });

/**
 * Puts a folder on screen. The folder row is a leaf — one click is the whole action, and clicking
 * the folder already up does nothing rather than folding anything away. What lands is the folder's
 * grid, or its start page while it has no session yet, so the header is what says it arrived.
 */
async function openFolder(name = "Sample Project"): Promise<void> {
  const row = page.getByRole("button", { name: `${name} 폴더 선택` });
  await row.click();
  await expect(page.locator(".workspace-title")).toContainText(name);
}

/**
 * Leaves a single pane on screen. Opening a folder brings up every session it has, so a test that
 * drives one terminal empties the other slots first — a slot emptied here keeps its session running
 * and keeps its sidebar row, so nothing is lost by it.
 */
async function soloPane(label: string): Promise<void> {
  const others = page.locator(`.grid-pane:not([aria-label="${label}"])`);
  for (let remaining = await others.count(); remaining > 0; remaining = await others.count()) {
    await others.first().getByRole("button", { name: "슬롯 비우기" }).click();
    await expect(others).toHaveCount(remaining - 1);
  }
  await expect(page.locator(".grid-pane")).toHaveCount(1);
}

/**
 * Drops a pane's sidebar row on a 작업공간 row. Electron hands Playwright no real HTML5 drag, so the
 * platform's own drag machinery cannot carry this one: the three events a drop is made of are
 * dispatched here instead, sharing a single DataTransfer exactly as the platform would. What the app
 * does with them — the payload type, the drop handler, the workspace it lands in — is untouched.
 */
async function dragPaneOnto(label: string, targetLabelPrefix: string): Promise<void> {
  await page.evaluate(
    ({ label, targetLabelPrefix }) => {
      const row = [...document.querySelectorAll<HTMLElement>(".session-row")].find(
        (candidate) => candidate.querySelector(".session-name")?.textContent?.trim() === label,
      );
      const target = document.querySelector<HTMLElement>(`[aria-label^="${targetLabelPrefix}"]`);
      if (!row || !target) throw new Error(`drag ${label} → ${targetLabelPrefix}: source or target missing`);
      const dataTransfer = new DataTransfer();
      const fire = (element: HTMLElement, type: string) =>
        element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
      fire(row, "dragstart");
      fire(target, "dragover");
      // Dispatching the events by hand skips the effect negotiation a real drag goes through, and a
      // dropEffect the drag never allowed is one the browser answers by cancelling the drop outright
      // — no drop event at all. Asserting it here is what keeps this helper from passing a drag the
      // platform would have thrown away.
      const allowed = dataTransfer.effectAllowed;
      const wanted = dataTransfer.dropEffect;
      const compatible =
        wanted === "none" ||
        allowed === "all" ||
        allowed === "uninitialized" ||
        allowed.toLowerCase().includes(wanted);
      if (!compatible) {
        throw new Error(`drop rejected: dropEffect "${wanted}" is not in effectAllowed "${allowed}"`);
      }
      fire(target, "drop");
      fire(row, "dragend");
    },
    { label, targetLabelPrefix },
  );
}

/** Deleting a session for good goes through the pane header's context menu, and takes effect at once. */
async function removeSessionFromPane(label: string): Promise<void> {
  await pane(label).locator(".pane-header").click({ button: "right" });
  await page.getByRole("menu", { name: `${label} 작업` }).getByRole("menuitem", { name: "제거" }).click();
  await expect(pane(label)).toBeHidden();
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
    await execFileAsync("git", ["remote", "add", "origin", "https://github.com/octo/sample.git"], { cwd: projectRoot });
    const fakeBin = path.join(tempRoot, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });
    const fakeGh = path.join(fakeBin, "gh.js");
    await fs.writeFile(fakeGh, `#!/usr/bin/env node
const args = process.argv.slice(2);
const pr = (number, title, state = "OPEN") => ({ number, title, state, isDraft: false, author: { login: "octo" }, updatedAt: "${NOW}", reviewDecision: "APPROVED", statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }], url: "https://github.com/octo/sample/pull/" + number, headRefOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
if (args[0] === "--version" || (args[0] === "auth" && args[1] === "status")) process.stdout.write("ok\\n");
else if (args[0] === "pr" && args[1] === "list") { const state = args[args.indexOf("--state") + 1]; process.stdout.write(JSON.stringify(state === "closed" ? [pr(2, "Closed PR", "CLOSED")] : [pr(1, "Open PR")])); }
else if (args[0] === "pr" && args[1] === "view") process.stdout.write(JSON.stringify({ ...pr(1, "Open PR"), body: "E2E body", labels: [{ name: "e2e", color: "1d76db" }], baseRefName: "main", headRefName: "feature", commits: [{ oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", messageHeadline: "change", committedDate: "${NOW}" }], reviews: [], comments: [], files: [{ path: "src/app.ts", additions: 1, deletions: 1, changeType: "MODIFIED" }, { path: "README.md", additions: 1, deletions: 0, changeType: "ADDED" }] }));
else if (args[0] === "pr" && args[1] === "diff") process.stdout.write("diff --git a/src/app.ts b/src/app.ts\\n--- a/src/app.ts\\n+++ b/src/app.ts\\n@@ -1 +1 @@\\n-old\\n+new\\ndiff --git a/README.md b/README.md\\nnew file mode 100644\\n--- /dev/null\\n+++ b/README.md\\n@@ -0,0 +1 @@\\n+readme\\n");
else if (args[0] === "api" && args.some((arg) => arg.includes("/comments"))) process.stdout.write("[]");
else { process.stderr.write("unsupported fake gh command: " + args.join(" ")); process.exitCode = 1; }
`, "utf8");
    if (WINDOWS) await fs.writeFile(path.join(fakeBin, "gh.cmd"), `@echo off\r\n"${process.execPath}" "%~dp0gh.js" %*\r\n`, "utf8");
    else { await fs.copyFile(fakeGh, path.join(fakeBin, "gh")); await fs.chmod(path.join(fakeBin, "gh"), 0o755); }
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
              commands: [WINDOWS ? "powershell" : "bash"],
              args: WINDOWS
                ? ["-NoLogo", "-NoExit", "-Command", "Write-Output MCW_CUSTOM_AGENT_READY"]
                : ["--login", "-c", "printf 'MCW_CUSTOM_AGENT_READY\\n'; exec bash --login"],
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

  test("@smoke runs a real native PTY and remains framed at both supported window sizes", async () => {
    await expect(page.getByRole("heading", { name: "멀티 터미널 작업기" })).toBeVisible();

    // A folder is a leaf now, so its select button is the row's only child and must consume the
    // whole row. If the old toggle/name/signal parent grid survives, this button is trapped in the
    // former 26px toggle column and the folder name disappears even though it stays accessible.
    const folderRowWidths = await page.locator(".project-row").first().evaluate((row) => ({
      row: row.getBoundingClientRect().width,
      select: row.querySelector<HTMLElement>(".project-select")?.getBoundingClientRect().width ?? 0,
    }));
    expect(folderRowWidths.select).toBeGreaterThanOrEqual(folderRowWidths.row - 1);
    await expect(page.locator(".project-row .project-name").first()).toBeVisible();

    await openFolder();

    // A folder opened before it has a single session: the start page stands in for the grid, and the
    // layout row stays put so the arrangement can be chosen before the first session exists.
    const startPage = page.getByRole("region", { name: "Sample Project 시작" });
    await expect(startPage.getByRole("heading", { name: "Sample Project에서 시작" })).toBeVisible();
    await expect(page.locator(".layout-bar")).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "레이아웃 선택" })).toBeVisible();
    await expect(startPage.getByText(/첫 세션은 .+ 배치로 열립니다/)).toBeVisible();
    await expect(startPage.locator(".git-branch")).toHaveText("main");
    await attachScreenshot("folder-start");

    await page.getByRole("button", { name: `새 ${SHELL_LABEL} 세션` }).click();
    await expect(startPage).toBeHidden();
    // The launchers stay exposed after the folder has a session.
    await expect(page.getByRole("button", { name: "새 Claude Code 세션" })).toBeVisible();

    const terminal = page.getByRole("region", { name: `${SHELL_ID} 터미널` });
    await expect(terminal).toBeVisible();
    await terminal.click();
    await page.keyboard.type(shellCommand("Write-Output MCW_PTY_READY", "echo MCW_PTY_READY"));
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
        return { name: element.className, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      }),
    );
    // Sub-pixel slack: fr rounding leaves rects a few ten-thousandths of a pixel past the viewport,
    // which no user can see. A real overflow is at least a pixel.
    for (const bound of bounds) {
      expect(bound.left, bound.name).toBeGreaterThanOrEqual(-0.5);
      expect(bound.top, bound.name).toBeGreaterThanOrEqual(-0.5);
      expect(bound.right, bound.name).toBeLessThanOrEqual(900.5);
      expect(bound.bottom, bound.name).toBeLessThanOrEqual(600.5);
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
    await page.keyboard.type(shellCommand(
      "1..150 | ForEach-Object { 'MCW_SCROLL_' + $_ }",
      "i=1; while [ $i -le 150 ]; do echo MCW_SCROLL_$i; i=$((i+1)); done",
    ));
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText("MCW_SCROLL_150");

    await page.keyboard.type(shellCommand(
      "Start-Sleep -Milliseconds 2000; [Console]::Write(([char]27).ToString() + '[?2026h' + ([char]27).ToString() + '[2JMCW_SYNC_FRAME' + ([char]27).ToString() + '[?2026l' + ([char]27).ToString() + ']9;MCW_SYNC_DONE' + ([char]7).ToString())",
      "sleep 2; printf '\\e[?2026h\\e[2JMCW_SYNC_FRAME\\e[?2026l\\e]9;MCW_SYNC_DONE\\a'",
    ));
    await page.keyboard.press("Enter");
    const scrollSlider = page.locator(".xterm-scrollable-element > .scrollbar.vertical > .slider");
    const sliderBounds = await scrollSlider.boundingBox();
    const viewportBounds = await page.locator(".xterm-scrollable-element").boundingBox();
    if (!sliderBounds || !viewportBounds) throw new Error("Terminal scroll bar is not available");
    await page.mouse.move(sliderBounds.x + sliderBounds.width / 2, sliderBounds.y + sliderBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(sliderBounds.x + sliderBounds.width / 2, viewportBounds.y + 1);
    await page.mouse.up();
    const earlyScrollbackRow = page.locator(".xterm-rows > div").filter({ hasText: /^MCW_SCROLL_5$/ });
    await expect(earlyScrollbackRow).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { __multiCliWorkE2eOutput?: string })
              .__multiCliWorkE2eOutput,
        ),
      )
      .toContain("\u001b]9;MCW_SYNC_DONE\u0007");
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    await expect(earlyScrollbackRow).toBeVisible();

    await terminal.click();
    await page.keyboard.type(shellCommand(
      "[Console]::Write(([char]27).ToString() + '[32mMCW_ANSI_GREEN' + ([char]27).ToString() + '[0m' + [Environment]::NewLine)",
      "printf '\\e[32mMCW_ANSI_GREEN\\e[0m'; echo",
    ));
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText("MCW_ANSI_GREEN");

    await page.keyboard.type(shellCommand(
      "[Console]::Write(([char]27).ToString() + ']9;MCW_OSC_SIGNAL' + ([char]7).ToString()); 1..250 | ForEach-Object { 'MCW_BURST_' + $_ }; exit 7",
      "printf '\\e]9;MCW_OSC_SIGNAL\\a'; i=1; while [ $i -le 250 ]; do echo MCW_BURST_$i; i=$((i+1)); done; exit 7",
    ));
    await page.keyboard.press("Enter");
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

    // The compact size is this test's subject, not the suite's. Leaving the window at 900x600 gave
    // every later test a terminal only a few rows tall, so a marker printed above a long prompt
    // scrolled out of the rendered rows before it could be read — a failure about window size
    // wearing the mask of whichever assertion happened to run there.
    await restoreDefaultWindowSize();
  });

  test("pastes each Ctrl+V shortcut exactly once from Electron's native clipboard", async () => {
    await openFolder();
    await page.getByRole("button", { name: `새 ${SHELL_LABEL} 세션` }).click();
    // The new session joins the folder's grid, and this test drives a single PTY — solo it.
    await expect(page.locator(".workspace-grid")).toHaveAttribute("data-slots", "2");
    await soloPane(`${SHELL_LABEL} 2`);
    const terminal = page.getByRole("region", { name: `${SHELL_ID} 터미널` });
    await terminal.click();
    await page.keyboard.type(shellCommand("$global:mcwPasteCount = 0", "mcwPasteCount=0"));
    await page.keyboard.press("Enter");

    await app.evaluate(
      ({ clipboard }, command) => clipboard.writeText(command),
      shellCommand(
        '$global:mcwPasteCount++; Write-Output ("MCW_CTRL_V_" + $global:mcwPasteCount)',
        'mcwPasteCount=$((mcwPasteCount+1)); echo "MCW_CTRL_V_$mcwPasteCount"',
      ),
    );
    await page.keyboard.press("Control+v");
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText("MCW_CTRL_V_1");
    await expect(page.locator(".xterm-rows")).not.toContainText("MCW_CTRL_V_2");

    await app.evaluate(
      ({ clipboard }, command) => clipboard.writeText(command),
      shellCommand(
        '$global:mcwPasteCount++; Write-Output ("MCW_CTRL_SHIFT_V_" + $global:mcwPasteCount)',
        'mcwPasteCount=$((mcwPasteCount+1)); echo "MCW_CTRL_SHIFT_V_$mcwPasteCount"',
      ),
    );
    await page.keyboard.press("Control+Shift+v");
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText("MCW_CTRL_SHIFT_V_2");
    await expect(page.locator(".xterm-rows")).not.toContainText("MCW_CTRL_SHIFT_V_3");

    await page.keyboard.type(shellCommand("Write-Output MCW_COPY_SOURCE", "echo MCW_COPY_SOURCE"));
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText("MCW_COPY_SOURCE");
    const copyRow = page.locator(".xterm-rows > div").filter({ hasText: "MCW_COPY_SOURCE" }).last();
    const box = await copyRow.boundingBox();
    if (!box) throw new Error("Copy source row is not visible");
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
    await page.mouse.up();

    await page.keyboard.press("Control+c");
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain("MCW_COPY_SOURCE");
    await page.keyboard.press("Control+Shift+c");
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain("MCW_COPY_SOURCE");
    await terminal.click();
    await page.keyboard.type("exit");
    await page.keyboard.press("Enter");
    await expect(page.locator(".active-status")).toHaveText("종료됨");
    await removeSessionFromPane(`${SHELL_LABEL} 2`);
    await expect(page.getByRole("region", { name: `${SHELL_ID} 터미널` })).toBeHidden();
  });

  test("keeps the Git sidebar contained at 220, 280, and 480px and opens the native graph", async () => {
    const projectRoot = path.join(tempRoot, "sample-project");
    const longParent = path.join(projectRoot, "a-very-long-parent-directory-name-that-must-not-expand-the-sidebar", "another-long-parent-directory");
    await fs.mkdir(longParent, { recursive: true });
    await fs.writeFile(path.join(longParent, "a-very-long-file-name-that-still-shows-its-status.ts"), "export const changed = true;\n");
    await execFileAsync("git", ["checkout", "-b", "feature/a-very-long-branch-name-for-responsive-layout"], { cwd: projectRoot });

    await openFolder();
    if ((await page.locator(".session-row").count()) === 0) {
      await page.getByRole("button", { name: `새 ${SHELL_LABEL} 세션` }).click();
      const terminal = page.getByRole("region", { name: `${SHELL_ID} 터미널` });
      await terminal.click();
      await page.keyboard.type("exit");
      await page.keyboard.press("Enter");
      await expect(page.locator(".active-status")).toHaveText("종료됨");
    } else if ((await page.locator(".pane-context-folder").count()) === 0) {
      await page.locator(".session-row").first().click();
    }
    await expect(page.locator(".pane-context-folder").first()).toBeVisible();
    await page.getByRole("tab", { name: "Git" }).click();
    await expect(page.getByText("a-very-long-file-name-that-still-shows-its-status.ts")).toBeVisible();

    expect(await computedFontSize("body")).toBe("13px");
    expect(await computedFontSize(".project-name")).toBe("13px");
    expect(await computedFontSize(".session-name")).toBe("13px");
    expect(await computedFontSize(".workspace-title")).toBe("14px");
    expect(await computedFontSize(".pane-context-folder")).toBe("13px");
    expect(await computedFontSize(".pane-title")).toBe("13px");
    expect(await computedFontSize(".right-sidebar-tab")).toBe("13px");
    expect(await computedFontSize(".git-panel-tabs button")).toBe("13px");
    expect(await computedFontSize(".git-panel .section-heading")).toBe("12px");
    expect(await computedFontSize(".git-change-path")).toBe("11px");
    expect(await computedFontSize(".git-status-badge")).toBe("11px");

    await page.getByRole("tab", { name: "파일" }).click();
    await expect(page.getByText("readme.md", { exact: true })).toBeVisible();
    expect(await computedFontSize(".file-tree-row")).toBe("13px");
    await page.getByRole("tab", { name: "Git" }).click();
    await expect(page.getByText("a-very-long-file-name-that-still-shows-its-status.ts")).toBeVisible();

    await page.evaluate(() => {
      const heading = document.querySelector<HTMLElement>(".git-panel .section-heading > span");
      const worktree = document.querySelector<HTMLElement>(".git-toolbar-secondary .git-dropdown-label");
      if (heading) heading.textContent = "an-extremely-long-repository-name-that-must-be-truncated";
      if (worktree) worktree.textContent = "an-extremely-long-worktree-name-that-must-be-truncated";
    });

    for (const width of [220, 280, 480]) {
      const result = await page.evaluate((sidebarWidth) => {
        const shell = document.querySelector<HTMLElement>(".app-shell")!;
        shell.style.setProperty("--right-sidebar-width", `${sidebarWidth}px`);
        const panel = document.querySelector<HTMLElement>(".git-panel")!;
        const controls = [...panel.querySelectorAll<HTMLElement>("button, .git-status-badge")];
        return new Promise<{ panel: { scrollWidth: number; clientWidth: number }; controlsVisible: boolean }>((resolve) => requestAnimationFrame(() => resolve({
          panel: { scrollWidth: panel.scrollWidth, clientWidth: panel.clientWidth },
          controlsVisible: controls.every((element) => {
            const rect = element.getBoundingClientRect();
            const panelRect = panel.getBoundingClientRect();
            return rect.left >= panelRect.left && rect.right <= panelRect.right;
          }),
        })));
      }, width);
      expect(result.panel.scrollWidth).toBeLessThanOrEqual(result.panel.clientWidth);
      expect(result.controlsVisible).toBe(true);
      await attachScreenshot(`git-sidebar-${width}`);
    }

    await page.evaluate(() => document.querySelector<HTMLElement>(".app-shell")!.style.setProperty("--right-sidebar-width", "280px"));
    await page.getByRole("button", { name: "Git Graph 열기" }).click();
    await expect(page.getByRole("region", { name: "Git Graph" })).toBeVisible();
    await expect(page.locator(".native-graph-row").first()).toBeVisible();
    await expect(page.getByText(/VS Code|serve-web/)).toHaveCount(0);
    await execFileAsync("git", ["checkout", "main"], { cwd: projectRoot });
  });

  test("@smoke filters and opens a PR, selects a file, annotates a line, and refreshes", async () => {
    await page.getByRole("tab", { name: "Git" }).click();
    await page.getByRole("tab", { name: "PR" }).click();
    await expect(page.getByText("Open PR", { exact: true })).toBeVisible();
    await page.getByLabel("PR 상태").selectOption("closed");
    await expect(page.getByText("Closed PR", { exact: true })).toBeVisible();
    await page.getByLabel("PR 상태").selectOption("open");
    await page.getByText("Open PR", { exact: true }).click();
    await expect(page.getByRole("region", { name: "PR #1 상세" })).toBeVisible();
    // A PR is read in a pane of its own — the diff needs the width, and the terminals it was sharing
    // the grid with keep running behind their tabs.
    await soloPane("#1 Open PR");
    await page.getByRole("tab", { name: /변경 파일/ }).click();
    await page.getByRole("button", { name: /README\.md/ }).click();
    await expect(page.locator(".pr-diff-line.add")).toContainText("readme");
    await page.getByRole("button", { name: "src/app.ts" }).click();
    await expect(page.locator(".pr-diff-line.add")).toContainText("new");
    await expect(page.locator(".pr-diff-line.del")).toContainText("old");
    await page.getByRole("button", { name: "src/app.ts RIGHT 1줄 line note 추가" }).click();
    await page.getByRole("textbox", { name: "Line note 본문" }).fill("rename this value");
    await page.getByRole("button", { name: "Draft 저장" }).click();
    await expect(page.getByRole("region", { name: "PR line notes" })).toContainText("Draft 1");
    await expect(page.getByRole("button", { name: "Draft 전송" })).toBeDisabled();
    await page.getByRole("region", { name: "PR #1 상세" }).getByRole("button", { name: "PR 새로고침" }).click();
    await expect(page.locator(".pr-selected-file-header")).toContainText("src/app.ts");
  });

  test("shows the home dashboard from the logo and the project detail page from the header", async () => {
    await page.getByRole("button", { name: "홈 대시보드 열기" }).click();
    await expect(page.getByRole("region", { name: "홈 대시보드" })).toBeVisible();
    await expect(page.getByRole("region", { name: "세션 모니터" })).toBeVisible();

    // A folder click opens its work — the terminals — and the 상세 page is a header click away.
    await openFolder();
    await expect(page.locator(".workspace-grid")).toBeVisible();
    await expect(page.getByRole("region", { name: "프로젝트 상세" })).toBeHidden();

    await page.getByRole("button", { name: "폴더 상세" }).click();
    await expect(page.getByRole("region", { name: "프로젝트 상세" })).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(`${SHELL_LABEL}( \\d+)? 세션 보기`) }).first()).toBeVisible();
  });

  /**
   * The window has no OS title bar and no native menu any more, so this bar is the only way to reach
   * what they used to offer. It has to be there, sit flush at the top, and actually drive the app.
   */
  test("@smoke drives the app from its own title bar instead of the native menu", async () => {
    expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu() === null)).toBe(true);

    const titleBar = page.locator(".title-bar");
    const geometry = await titleBar.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, height: Math.round(rect.height) };
    });
    expect(geometry).toEqual({ top: 0, height: 35 });
    for (const label of ["파일", "편집", "보기", "세션", "도구", "도움말"]) {
      await expect(titleBar.getByRole("menuitem", { name: label })).toBeVisible();
    }
    for (const label of ["최소화", "최대화", "닫기"]) {
      await expect(titleBar.getByRole("button", { name: label })).toBeVisible();
    }

    // Folding the sidebar is the least invasive item that proves a menu click reaches the app.
    await titleBar.getByRole("menuitem", { name: "보기" }).click();
    await page.getByRole("menu", { name: "보기" }).getByRole("menuitem", { name: "왼쪽 사이드바 접기" }).click();
    await expect(page.locator(".app-shell.sidebar-collapsed")).toBeVisible();
    await titleBar.getByRole("menuitem", { name: "보기" }).click();
    await page.getByRole("menu", { name: "보기" }).getByRole("menuitem", { name: "왼쪽 사이드바 펼치기" }).click();
    await expect(page.locator(".app-shell.sidebar-collapsed")).toBeHidden();

    await titleBar.getByRole("menuitem", { name: "도움말" }).click();
    await expect(page.getByRole("menu", { name: "도움말" })).toBeVisible();
    await attachScreenshot("title-bar");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "도움말" })).toBeHidden();

    const commandCentre = titleBar.getByRole("button", { name: "빠른 열기" });
    await expect(commandCentre).toContainText("Sample Project");
    await commandCentre.click();
    await expect(page.getByRole("dialog", { name: "빠른 열기" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "빠른 열기" })).toBeHidden();
  });

  test("@smoke toggles and immediately saves a Markdown task", async () => {
    const readmePath = path.join(tempRoot, "sample-project", "readme.md");
    await fs.writeFile(readmePath, "# Smoke checklist\n\n- [ ] verify Markdown\n", "utf8");
    await page.locator(".file-explorer").getByRole("tab", { name: "파일", exact: true }).click();
    await page.locator(".file-explorer").getByRole("button", { name: "readme.md", exact: true }).click();
    const checkbox = page.getByRole("checkbox", { name: "작업 1" });
    await expect(checkbox).not.toBeChecked();
    await checkbox.click();
    await expect(checkbox).toBeChecked();
    await expect.poll(() => fs.readFile(readmePath, "utf8")).toContain("- [x] verify Markdown");
  });

  /**
   * The whole point of the agent registry: a CLI the app ships no code for is launchable purely from
   * `agents.json`, and it stands next to the built-ins rather than behind them.
   */
  test("@smoke runs an agent the user added in agents.json", async () => {
    await openFolder();
    await expect(page.getByRole("button", { name: `새 ${SHELL_LABEL} 세션` })).toBeVisible();

    await page.getByRole("button", { name: "새 Echo Agent 세션" }).click();

    const terminal = page.getByRole("region", { name: "echo-agent 터미널" });
    await expect(terminal).toBeVisible();
    await expect(terminal.locator(".xterm-rows")).toContainText("MCW_CUSTOM_AGENT_READY");
    // It takes the next free slot of the folder's grid rather than replacing what was on screen.
    await expect(pane("Echo Agent")).toBeVisible();
    await expect(pane(SHELL_LABEL)).toBeVisible();
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
      // ＋ 새 세션 rides at the end of the row, past every agent, so the far edge lands on it.
      await launcherRow.evaluate((element) => element.scrollTo({ left: element.scrollWidth }));
      await expect(launcherRow.getByRole("button", { name: "최근 폴더에서 새 세션" })).toBeInViewport();

      // The agent the user added is reachable from the other direction: the row scrolls both ways
      // rather than clipping whatever does not fit.
      const customAgent = launcherRow.getByRole("button", { name: "새 Echo Agent 세션" });
      await customAgent.evaluate((element) => element.scrollIntoView({ block: "nearest", inline: "nearest" }));
      await expect(customAgent).toBeInViewport();
    }
  });

  test("jumps between sessions with the quick open palette", async () => {
    // Focus sits inside the Echo Agent terminal from the previous test — the palette shortcut
    // must win over the terminal, which is the whole point of the capture-phase listener.
    await page.keyboard.press("Control+p");
    const palette = page.getByRole("dialog", { name: "빠른 열기" });
    await expect(palette).toBeVisible();

    await page.keyboard.type(WINDOWS ? "power" : "bash");
    await page.keyboard.press("Enter");
    await expect(palette).toBeHidden();
    // The session is already on screen, so the jump moves the focus rather than rebuilding the grid.
    await expect(page.getByRole("region", { name: `${SHELL_ID} 터미널` })).toBeVisible();
    await expect(page.locator(".grid-pane.pane-focused")).toHaveAttribute("aria-label", SHELL_LABEL);

    await page.keyboard.press("Control+p");
    await expect(palette).toBeVisible();
    await attachScreenshot("quick-open");
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  });

  /**
   * The parallel worktree loop end to end: an isolated worktree, a session running inside it,
   * one prompt fanned out to every live session, the diff of what happened, and a removal that
   * refuses to discard uncommitted work until forced explicitly.
   */
  test("@smoke runs a worktree session, fans out a prompt, and guards worktree removal", async () => {
    await page.getByRole("button", { name: "Sample Project 폴더 선택" }).click({ button: "right" });
    await page.getByRole("menu", { name: "Sample Project 작업" }).getByRole("menuitem", { name: "Worktree 만들기" }).click();
    const createDialog = page.getByRole("dialog", { name: "Worktree 만들기" });
    await createDialog.getByRole("textbox", { name: "브랜치 이름" }).fill("feature/e2e");
    await createDialog.getByRole("button", { name: "만들기" }).click();

    // The new worktree opens scoped, on its own start page — the 워크트리 card there names the
    // checkout you are on, which is where the tree's worktree row used to say it.
    await expect(
      page.getByRole("region", { name: "워크트리" }).getByRole("button", { name: "feature/e2e (보는 중)" }),
    ).toBeVisible();
    // A session started here runs in the worktree directory.
    await page.getByRole("button", { name: `새 ${SHELL_LABEL} 세션` }).click();
    const terminal = page.getByRole("region", { name: `${SHELL_ID} 터미널` });
    await expect(terminal).toBeVisible();
    await terminal.click();
    await page.keyboard.type(shellCommand('Write-Output ("MCW_PWD_" + $PWD.Path)', 'echo "MCW_PWD_$PWD"'));
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText("sample-project-wt");
    await attachScreenshot("worktree-session");

    // Fan one prompt out to every live session of the project (worktree + Echo Agent).
    await openFolder();
    // The folder's grid holds every session it has, the worktree's included — nothing was pushed off
    // to make room for the new one. Two unnamed shells of one project are numbered, so the first
    // session takes the "1" suffix from here until the worktree is removed again.
    await expect(pane(`${SHELL_LABEL} 1`)).toBeVisible();
    await expect(pane(`${SHELL_LABEL} 2`)).toBeVisible();
    await expect(pane("Echo Agent")).toBeVisible();
    await page.getByRole("button", { name: "폴더 상세" }).click();
    await page.getByRole("button", { name: "프롬프트 팬아웃" }).click();
    const fanOut = page.getByRole("dialog", { name: "프롬프트 팬아웃" });
    await expect(fanOut.getByRole("checkbox")).toHaveCount(2);
    await fanOut.getByRole("textbox", { name: "팬아웃 프롬프트" }).fill(
      shellCommand("Write-Output MCW_FANOUT_OK", "echo MCW_FANOUT_OK"),
    );
    await attachScreenshot("fan-out");
    await fanOut.getByRole("button", { name: "2개 세션에 전송" }).click();
    await expect(fanOut).toBeHidden();
    // Both recipients are panes of the same grid, so one look shows what each of them received.
    await openFolder();
    await expect(pane(`${SHELL_LABEL} 2`).locator(".xterm-rows")).toContainText("MCW_FANOUT_OK");
    await expect(pane("Echo Agent").locator(".xterm-rows")).toContainText("MCW_FANOUT_OK");

    // Leave an uncommitted file in the worktree, then read it back from the diff view.
    await pane(`${SHELL_LABEL} 2`).locator(".terminal-surface").click();
    // The marker is concatenated so it appears in the command's OUTPUT only — the echoed input
    // line must not satisfy the wait, or the diff races the file write.
    await page.keyboard.type(shellCommand(
      'Set-Content -Path wip.txt -Value MCW_DIRTY; Write-Output ("MCW_WROTE_" + "DONE")',
      "echo MCW_DIRTY > wip.txt; echo MCW_WROTE_DONE",
    ));
    await page.keyboard.press("Enter");
    await expect(pane(`${SHELL_LABEL} 2`).locator(".xterm-rows")).toContainText("MCW_WROTE_DONE");
    // The tree has no worktree rows any more: the menu hangs off the 워크트리 card of the folder's
    // 상세 page. Pressing the worktree's pane scoped the app to that worktree, so the folder row is
    // clicked again first — on the folder itself the card lists feature/e2e as one to open, and
    // only an openable row carries the context menu.
    await openFolder();
    await page.getByRole("button", { name: "폴더 상세" }).click();
    const worktreeCardRow = page
      .getByRole("region", { name: "워크트리" })
      .getByRole("button", { name: /^feature\/e2e/ });
    await worktreeCardRow.click({ button: "right" });
    await page.getByRole("menu", { name: "feature/e2e worktree 작업" }).getByRole("menuitem", { name: "변경 보기" }).click();
    const diff = page.getByRole("dialog", { name: "변경 보기" });
    await expect(diff).toContainText("wip.txt");
    await attachScreenshot("worktree-diff");
    await diff.getByRole("button", { name: "변경 보기 닫기" }).click();

    // Removal refuses over the uncommitted file until the explicit force confirmation. Closing the
    // diff left the 상세 page up, so the same card row is still the way in.
    await worktreeCardRow.click({ button: "right" });
    await page.getByRole("menu", { name: "feature/e2e worktree 작업" }).getByRole("menuitem", { name: "Worktree 제거" }).click();
    const confirm = page.getByRole("dialog", { name: "Worktree 제거" });
    await expect(confirm).toContainText("세션 1개");
    await confirm.getByRole("button", { name: "제거" }).click();
    const force = page.getByRole("dialog", { name: "Worktree 강제 제거" });
    await expect(force).toContainText("커밋되지 않은 변경");
    await attachScreenshot("worktree-force-remove");
    await force.getByRole("button", { name: "변경을 버리고 강제 제거" }).click();
    await expect(worktreeCardRow).toBeHidden();
    expect(
      await fs.stat(path.join(tempRoot, "sample-project-wt", "feature-e2e")).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  });

  test("discovers an externally-created worktree and safely removes it after a real PTY change", async () => {
    const projectRoot = path.join(tempRoot, "sample-project");
    const externalPath = path.join(tempRoot, "external worktree");
    await execFileAsync("git", ["-C", projectRoot, "worktree", "add", "-b", "feature/external", externalPath]);

    // exact: the right sidebar's "파일 목록 새로고침" also matches the substring.
    await page.getByRole("button", { name: "목록 새로고침", exact: true }).click();
    // A discovered worktree shows up on the folder's 워크트리 card, the tree having no layer for it.
    await page.getByRole("button", { name: "Sample Project 폴더 선택" }).click();
    await page.getByRole("button", { name: "폴더 상세" }).click();
    const row = page
      .getByRole("region", { name: "워크트리" })
      .getByRole("button", { name: "feature/external 워크트리 열기" });
    await expect(row).toBeVisible();
    await row.click();
    await page.getByRole("button", { name: `새 ${SHELL_LABEL} 세션` }).click();
    const terminal = page.getByRole("region", { name: `${SHELL_ID} 터미널` });
    await terminal.click();
    await page.keyboard.type(shellCommand(
      'Set-Content -Path external.txt -Value MCW_EXTERNAL; Write-Output MCW_EXTERNAL_DONE',
      "echo MCW_EXTERNAL > external.txt; echo MCW_EXTERNAL_DONE",
    ));
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText("MCW_EXTERNAL_DONE");

    // Back to the folder's own 상세 page: on the worktree you are viewing the card row is disabled,
    // and a disabled button hands the wrapper no right-click to open the menu with.
    await page.getByRole("button", { name: "Sample Project 폴더 선택" }).click();
    await page.getByRole("button", { name: "폴더 상세" }).click();
    await row.click({ button: "right" });
    await page.getByRole("menu", { name: "feature/external worktree 작업" }).getByRole("menuitem", { name: "Worktree 제거" }).click();
    await page.getByRole("dialog", { name: "Worktree 제거" }).getByRole("button", { name: "제거" }).click();
    await page.getByRole("dialog", { name: "Worktree 강제 제거" }).getByRole("button", { name: "변경을 버리고 강제 제거" }).click();
    await expect(row).toBeHidden();
    await expect.poll(() => fs.stat(externalPath).then(() => true, () => false)).toBe(false);
  });

  test("@smoke hides to the tray and restores saved tabs after a relaunch", async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(false);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(true);

    // Playwright's app.close() follows Electron's before-quit path. Stop the remaining live test
    // agent first so the product's native destructive-quit confirmation does not block automation.
    await openFolder();
    await pane("Echo Agent").getByRole("button", { name: "세션 중지" }).click();
    await expect(page.locator(".active-status")).toHaveText("종료됨");
    await app.close();
    ({ app, page } = await launchApp());

    // The whole arrangement comes back, not just the one session that had the focus. Documents are
    // not saved across a run, so what is restored is the two sessions and the layout they were on.
    await expect(page.locator(".workspace-grid")).toHaveAttribute("data-slots", "2");
    await expect(pane("Echo Agent")).toBeVisible();
    await expect(pane(SHELL_LABEL).getByRole("button", { name: "세션 재개" })).toBeVisible();
  });

  /**
   * The grid is the whole session UI now: the folder's terminals arrive together, every pane runs
   * its own session, and each pane's header is where that session is resumed, renamed, or set aside.
   */
  test("runs each grid pane on its own session from its own header", async () => {
    // Both sessions exited with the relaunch; each pane resumes its own from its own header.
    await pane("Echo Agent").getByRole("button", { name: "세션 재개" }).click();
    await expect(pane("Echo Agent").getByRole("button", { name: "세션 중지" })).toBeVisible();
    await pane(SHELL_LABEL).getByRole("button", { name: "세션 재개" }).click();
    await expect(pane(SHELL_LABEL).getByRole("button", { name: "세션 중지" })).toBeVisible();

    // Input typed into one pane must never leak into the other.
    await pane(SHELL_LABEL).locator(".terminal-surface").click();
    await page.keyboard.type(shellCommand("Write-Output MCW_PANE_SHELL", "echo MCW_PANE_SHELL"));
    await page.keyboard.press("Enter");
    await expect(pane(SHELL_LABEL).locator(".xterm-rows")).toContainText("MCW_PANE_SHELL");
    await expect(pane("Echo Agent").locator(".xterm-rows")).not.toContainText("MCW_PANE_SHELL");

    await pane("Echo Agent").locator(".terminal-surface").click();
    await page.keyboard.type(shellCommand("Write-Output MCW_PANE_AGENT", "echo MCW_PANE_AGENT"));
    await page.keyboard.press("Enter");
    await expect(pane("Echo Agent").locator(".xterm-rows")).toContainText("MCW_PANE_AGENT");
    await expect(pane(SHELL_LABEL).locator(".xterm-rows")).not.toContainText("MCW_PANE_AGENT");
    await attachScreenshot("workspace-grid");

    // Pressing a pane is what moves the focus the header reports.
    await expect(page.locator(".grid-pane.pane-focused")).toHaveAttribute("aria-label", "Echo Agent");

    // Every pane opens with the folder it runs in, whatever its session came to be called.
    await expect(pane("Echo Agent").locator(".pane-context")).toHaveText("Sample Project");
    await expect(pane(SHELL_LABEL).locator(".pane-context")).toHaveText("Sample Project");

    // The pane header renames its session in place, and its context menu puts the name back.
    await pane("Echo Agent").locator(".pane-title").dblclick();
    const nameField = page.getByRole("textbox", { name: "세션 이름" });
    await nameField.fill("MCW 이름");
    await nameField.press("Enter");
    await expect(pane("MCW 이름")).toBeVisible();
    await pane("MCW 이름").locator(".pane-header").click({ button: "right" });
    await page
      .getByRole("menu", { name: "MCW 이름 작업" })
      .getByRole("menuitem", { name: "제공자 제목 사용" })
      .click();
    await expect(pane("Echo Agent")).toBeVisible();

    // Emptying a slot only takes the pane off screen: the session keeps running and keeps its
    // sidebar row, and the row puts it back — with everything it went on saying while it was away,
    // and without displacing the pane that stayed.
    await pane(SHELL_LABEL).getByRole("button", { name: "슬롯 비우기" }).click();
    await expect(page.locator(".workspace-grid")).toHaveAttribute("data-slots", "1");
    await expect(pane(SHELL_LABEL)).toBeHidden();
    await paneRow(SHELL_LABEL).click();
    await expect(pane(SHELL_LABEL).locator(".xterm-rows")).toContainText("MCW_PANE_SHELL");
    await expect(pane("Echo Agent")).toBeVisible();
  });

  /**
   * The three ways a pane is put where the user wants it: the sidebar reaches one on any page, the
   * layout row decides how many fit at once (the rest paginate rather than disappear), and a row
   * dragged onto 숨김 takes a pane off 작업공간 — which, collecting everything the app holds, is
   * otherwise the one screen a pane cannot be left out of.
   */
  test("moves panes by sidebar row, layout and page, and puts one away on 숨김", async () => {
    const layoutBar = page.locator(".layout-bar");
    const hiddenRow = page.getByRole("button", { name: /숨김 열기/ });

    // A row click moves the focus; it rearranges nothing.
    await paneRow(SHELL_LABEL).click();
    await expect(page.locator(".grid-pane.pane-focused")).toHaveAttribute("aria-label", SHELL_LABEL);

    // The layout is what says how many panes a page holds. Down to one, and the second session is
    // not gone — it is on page two, still running, still a row in the tree.
    await layoutBar.getByRole("radio", { name: "1열" }).click();
    await expect(page.locator(".workspace-grid")).toHaveAttribute("data-layout", "cols:1");
    await expect(page.locator(".grid-pane")).toHaveCount(1);
    await expect(pane("Echo Agent")).toBeVisible();
    await expect(paneRow(SHELL_LABEL)).toBeVisible();
    await expect(page.getByLabel("2페이지 중 1페이지")).toBeVisible();

    await page.getByRole("button", { name: "다음 페이지" }).click();
    await expect(page.getByLabel("2페이지 중 2페이지")).toBeVisible();
    await expect(pane(SHELL_LABEL)).toBeVisible();
    await expect(pane("Echo Agent")).toBeHidden();

    // Every session collected itself into 작업공간 as it was created — nothing was dragged for that
    // — and 숨김 stays empty until something is put there on purpose. The exact count is whatever the
    // tests before this one left running, so what is asserted is the move, not the number.
    const activeCount = async () => {
      const label = await page.getByRole("button", { name: /작업공간 열기/ }).getAttribute("aria-label");
      const count = Number(/패인 (\d+)개/.exec(label ?? "")?.[1]);
      expect(count).toBeGreaterThan(0);
      return count;
    };
    const collected = await activeCount();
    await expect(page.getByRole("button", { name: "숨김 열기 (패인 0개)" })).toBeVisible();

    // The drop moves the pane rather than copying it: a pane sits on exactly one of the two shelves,
    // and it keeps its place in the folder's own grid either way.
    await dragPaneOnto("Echo Agent", "숨김 열기");
    await expect(page.getByRole("button", { name: "숨김 열기 (패인 1개)" })).toBeVisible();
    await expect(page.getByRole("button", { name: `작업공간 열기 (패인 ${collected - 1}개)` })).toBeVisible();

    // 숨김 is a grid of its own, so a pane taken off 작업공간 can still be looked at.
    await hiddenRow.click();
    await expect(page.locator(".workspace-title")).toHaveText("숨김");
    await expect(pane("Echo Agent")).toBeVisible();
    await expect(pane(SHELL_LABEL)).toBeHidden();

    // Expanding the row is how a shelf says what it holds, now that panes have no tabs.
    await page.getByRole("button", { name: "숨김 펼치기" }).click();
    const shelfPanes = page.getByRole("group", { name: "숨김 패인" });
    await expect(shelfPanes.getByRole("button", { name: "Echo Agent 패인 열기" })).toBeVisible();
    await attachScreenshot("workspace-shelf");

    // The ✕ on a shelf row is the way back, and it ends nothing: the session is still running when
    // it lands on 작업공간 again.
    await shelfPanes.getByRole("button", { name: "Echo Agent 작업공간에 다시 표시" }).click();
    await expect(page.getByRole("button", { name: "숨김 열기 (패인 0개)" })).toBeVisible();
    await expect(page.getByRole("button", { name: `작업공간 열기 (패인 ${collected}개)` })).toBeVisible();

    // Back to the folder, which kept both panes and the layout it was left on.
    await openFolder();
    await expect(page.locator(".workspace-grid")).toHaveAttribute("data-layout", "cols:1");
    await layoutBar.getByRole("radio", { name: "자동" }).click();
    await expect(page.locator(".workspace-grid")).toHaveAttribute("data-slots", "2");
    await expect(pane(SHELL_LABEL)).toBeVisible();
    await expect(pane("Echo Agent")).toBeVisible();
  });

  /**
   * Leaving the terminal view unmounts the pane, so coming back builds a fresh xterm and replays the
   * PTY's stored scrollback into it. That replay was produced at the PTY's own width, so a terminal
   * still on xterm's 80x24 default re-wraps every line of it — lines padded toward the right edge,
   * which is what a full-screen CLI like Codex draws, fold into extra blank lines. The scrollback
   * has to survive the round trip unchanged.
   */
  test("@smoke keeps terminal scrollback intact after leaving the session and coming back", async () => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openFolder();
    await page.getByRole("button", { name: `새 ${SHELL_LABEL} 세션` }).click();
    // The replay is measured in columns, so this one keeps the full width to itself. Emptying the
    // other slots is not enough: a folder view refills itself every time it is opened, so the layout
    // — which is what actually decides how many panes a page holds — is pinned to one as well.
    await expect(page.locator(".workspace-grid")).toHaveAttribute("data-slots", "3");
    await soloPane(`${SHELL_LABEL} 2`);
    await page.locator(".layout-bar").getByRole("radio", { name: "1열" }).click();
    await expect(page.locator(".workspace-grid")).toHaveAttribute("data-slots", "1");
    const terminal = page.getByRole("region", { name: `${SHELL_ID} 터미널` });
    await expect(terminal).toBeVisible();
    await terminal.click();

    // Absolute column addressing (CHA) is what a full-screen CLI uses to draw at a fixed position.
    // A terminal narrower than the target column clamps it, so replaying this into a terminal still
    // on xterm's 80x24 default puts the text somewhere else entirely — and unlike a plain re-wrap,
    // no later reflow can move it back. The marker is split in the source so the echoed command
    // line does not contain it.
    await page.keyboard.type(
      shellCommand(
        `[Console]::Write([char]27 + "[90G" + ("MCW" + "COL") + [char]10)`,
        `printf '\\033[90G%s%s\\n' MCW COL`,
      ),
    );
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows").first()).toContainText("MCWCOL");

    const markerColumn = () =>
      page
        .locator(".xterm-rows")
        .first()
        .evaluate((element) => {
          const row = Array.from(element.children)
            .map((element) => (element.textContent ?? "").replace(/ /g, " "))
            .find((text) => text.includes("MCWCOL"));
          return row === undefined ? -1 : row.indexOf("MCWCOL");
        });

    // Column 90, one-based, is index 89 — as long as the terminal really is that wide.
    await expect.poll(markerColumn).toBe(89);

    await page.getByRole("button", { name: "홈 대시보드 열기" }).click();
    await expect(page.getByRole("region", { name: "홈 대시보드" })).toBeVisible();
    await expect(terminal).toBeHidden();

    // Coming back through the home monitor lands on the page this session is on, and the one-pane
    // layout means the terminal keeps the width the marker was measured against.
    await page.getByRole("button", { name: `${SHELL_LABEL} 2 세션으로 이동` }).click();
    await expect(page.locator(".workspace-grid")).toHaveAttribute("data-slots", "1");
    await expect(terminal).toBeVisible();
    await expect(page.locator(".xterm-rows").first()).toContainText("MCWCOL");

    // Not expect.poll: the point is that the replay lands correctly the first time. A late reflow
    // can repair a plain re-wrap seconds later, but it never moves absolutely-addressed text back,
    // and waiting for it would hide the regression this test exists for.
    expect(await markerColumn()).toBe(89);

    // Leave no live PTY behind: app.close() follows the before-quit path, where the product's
    // native destructive-quit confirmation would block the afterAll hook.
    await terminal.click();
    await page.keyboard.type("exit");
    await page.keyboard.press("Enter");
    await expect(page.locator(".active-status")).toHaveText("종료됨");
    await removeSessionFromPane(`${SHELL_LABEL} 2`);
  });

  /**
   * Adding work is not switching to it. The session really starts and really gets its row, but the
   * screen the user was reading — here the home dashboard — and the keyboard focus stay put.
   */
  test("starts a session from the folder's context menu without leaving the screen", async () => {
    await page.getByRole("button", { name: "홈 대시보드 열기" }).click();
    const dashboard = page.getByRole("region", { name: "홈 대시보드" });
    await expect(dashboard).toBeVisible();

    const rows = page.locator(".session-row");
    const before = await rows.count();
    // The row the focus is on, if any — the session that quietly starts must not take it over.
    const focusedRowLabels = () =>
      page.locator(".session-row.current").evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")));
    const focusedBefore = await focusedRowLabels();

    await page.getByRole("button", { name: "Sample Project 폴더 선택" }).click({ button: "right" });
    const menu = page.getByRole("menu", { name: "Sample Project 작업" });
    await expect(menu.getByText("새 세션")).toBeVisible();
    await menu.getByRole("menuitem", { name: SHELL_LABEL, exact: true }).click();
    await expect(menu).toBeHidden();

    await expect(rows).toHaveCount(before + 1);
    await expect(dashboard).toBeVisible();
    await expect(page.getByRole("region", { name: `${SHELL_ID} 터미널` })).toBeHidden();
    expect(await focusedRowLabels()).toEqual(focusedBefore);
  });

  test("설정에서 바꾼 터미널 글꼴 크기가 살아있는 세션에 즉시 반영된다 @smoke", async () => {
    await openFolder();
    await expect(page.locator(".xterm")).toBeVisible();

    await page.getByRole("menuitem", { name: "설정" }).click();
    await expect(page.getByRole("dialog", { name: "설정" })).toBeVisible();
    await page.getByRole("button", { name: "터미널" }).click();
    await page.getByLabel("글꼴 크기").fill("20");

    try {
      // xterm(DOM 렌더러)은 폰트 크기를 .xterm-rows에 얹는다 — 재생성 없이 20px이 되어야 한다.
      await expect.poll(() => computedFontSize(".xterm-rows")).toBe("20px");
    } finally {
      // 되돌리고 닫는다 — 같은 창을 쓰는 뒤 테스트가 13px 전제를 잃지 않게.
      await page.getByLabel("글꼴 크기").fill("13");
      await expect.poll(() => computedFontSize(".xterm-rows")).toBe("13px");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "설정" })).toBeHidden();
    }
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
    await expect(page.getByText("아직 프로젝트가 없습니다")).toBeVisible();
    expect((await fs.stat(projectRoot)).isDirectory()).toBe(true);

    const savedRegistry = JSON.parse(await fs.readFile(path.join(tempRoot, "registry", "projects.json"), "utf8"));
    expect(savedRegistry.projects).toEqual({});
  });
});
