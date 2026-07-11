import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
      MULTI_CLI_WORK_CLAUDE_PROJECTS_DIR: path.join(tempRoot, "claude-projects"),
      MULTI_CLI_WORK_CODEX_SESSIONS_DIR: path.join(tempRoot, "codex-sessions"),
    },
  });
  return { app: nextApp, page: await nextApp.firstWindow() };
}

async function attachScreenshot(name: string): Promise<void> {
  await test.info().attach(name, { body: await page.screenshot(), contentType: "image/png" });
}

test.describe.serial("Multi CLI Work desktop", () => {
  test.beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "multi-cli-work-e2e-"));
    const projectRoot = path.join(tempRoot, "sample-project");
    await Promise.all([
      fs.mkdir(projectRoot, { recursive: true }),
      fs.mkdir(path.join(tempRoot, "registry"), { recursive: true }),
      fs.mkdir(path.join(tempRoot, "claude-projects"), { recursive: true }),
      fs.mkdir(path.join(tempRoot, "codex-sessions"), { recursive: true }),
    ]);
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
    ({ app, page } = await launchApp());
  });

  test.afterAll(async () => {
    await app?.close().catch(() => undefined);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  test("runs a real PowerShell PTY and remains framed at both supported window sizes", async () => {
    await expect(page.getByRole("heading", { name: "Multi CLI Work" })).toBeVisible();
    await page.getByRole("button", { name: "Select project Sample Project" }).click();
    await page.getByRole("button", { name: "New session" }).click();
    await page.getByRole("menuitem", { name: "New PowerShell session" }).click();

    const terminal = page.getByRole("region", { name: "powershell terminal" });
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
    await expect(page.locator(".active-status")).toHaveText("Exited");
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

  test("hides to the tray and restores saved tabs after a relaunch", async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(false);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(true);

    await app.close();
    ({ app, page } = await launchApp());

    await expect(page.getByRole("button", { name: "Open PowerShell session" })).toBeVisible();
    await page.getByRole("button", { name: "Open PowerShell session" }).click();
    await expect(page.getByRole("button", { name: "Resume session" })).toBeVisible();
  });
});
