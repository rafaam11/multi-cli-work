import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-07-11T12:00:00.000Z";
const WINDOWS = process.platform === "win32";
const SHELL_ID = WINDOWS ? "powershell" : "bash";
const SHELL_LABEL = WINDOWS ? "PowerShell" : "Bash";

let tempRoot: string;
let app: ElectronApplication;
let page: Page;
let port: number;
let mouseScript: string;

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

/**
 * 폰 역할은 같은 Electron 안에 띄운 두 번째 창이 맡는다 — 별도 브라우저를 설치하지 않아도 되고,
 * 그 창은 preload 없이 원격 서버가 서빙한 /mobile/ 페이지만 본다. 서버는 Tailscale 대신
 * MULTI_CLI_WORK_REMOTE_BIND=127.0.0.1에 뜬다.
 */
test.describe.serial("Mobile companion", () => {
  test.beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "multi-cli-work-mobile-e2e-"));
    port = await freePort();
    // claude처럼 전체 화면(alternate screen)과 SGR 마우스 추적을 켜고 q가 올 때까지 기다리는 앱.
    mouseScript = path.join(tempRoot, "mouse-echo.js");
    await fs.writeFile(
      mouseScript,
      String.raw`process.stdout.write("\x1b[?1049h\x1b[?1000h\x1b[?1006hMCW_ALT_READY\r\n");
process.stdin.setRawMode(true);
process.stdin.on("data", (data) => {
  const text = data.toString("latin1");
  if (text.includes("q")) { process.stdout.write("\x1b[?1000l\x1b[?1006l\x1b[?1049l"); process.exit(0); }
});
`,
      "utf8",
    );
    const projectRoot = path.join(tempRoot, "sample-project");
    await Promise.all([
      fs.mkdir(projectRoot, { recursive: true }),
      fs.mkdir(path.join(tempRoot, "registry"), { recursive: true }),
      fs.mkdir(path.join(tempRoot, "codex-sessions"), { recursive: true }),
      fs.mkdir(path.join(tempRoot, "user-data"), { recursive: true }),
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
    await fs.writeFile(
      path.join(tempRoot, "user-data", "settings.json"),
      `${JSON.stringify({ remote: { enabled: true, port } })}\n`,
      "utf8",
    );
    app = await electron.launch({
      args: [path.resolve("out/main/index.js")],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
        MULTI_CLI_WORK_USER_DATA: path.join(tempRoot, "user-data"),
        MULTI_CLI_WORK_REGISTRY_PATH: path.join(tempRoot, "registry", "projects.json"),
        MULTI_CLI_WORK_CODEX_SESSIONS_DIR: path.join(tempRoot, "codex-sessions"),
        MULTI_CLI_WORK_AGENTS_PATH: path.join(tempRoot, "registry", "agents.json"),
        MULTI_CLI_WORK_WORK_PROJECTS_PATH: path.join(tempRoot, "registry", "work-projects.json"),
        MULTI_CLI_WORK_WORKTREES_PATH: path.join(tempRoot, "registry", "worktrees.json"),
        MULTI_CLI_WORK_PR_REVIEWS_PATH: path.join(tempRoot, "registry", "pr-reviews.json"),
        MULTI_CLI_WORK_WORKSPACE_PATH: path.join(tempRoot, "registry", "workspace.json"),
        MULTI_CLI_WORK_PROJECT_TAGS_PATH: path.join(tempRoot, "registry", "project-tags.json"),
        MULTI_CLI_WORK_REMOTE_BIND: "127.0.0.1",
      },
    });
    page = await app.firstWindow();
  });

  test.afterAll(async () => {
    await app?.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    }).catch(() => undefined);
    await app?.close().catch(() => undefined);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  test("pairs a phone, lists the session, and types into it", async () => {
    await expect(page.getByRole("heading", { name: "멀티 터미널 작업기" })).toBeVisible();
    await page.getByRole("button", { name: "Sample Project 폴더 선택" }).click();
    await page.getByRole("button", { name: `새 ${SHELL_LABEL} 세션` }).click();
    await expect(page.getByRole("region", { name: `${SHELL_ID} 터미널` })).toBeVisible();

    await expect
      .poll(() => page.evaluate(() => window.multiCliWork.remote.status().then((status) => status.state)))
      .toBe("listening");
    const pairing = await page.evaluate(() => window.multiCliWork.remote.issuePairingCode());
    expect(pairing.url).toBe(`http://127.0.0.1:${port}/mobile/`);

    const phonePromise = app.waitForEvent("window");
    await app.evaluate(({ BrowserWindow }, url) => {
      const phoneWindow = new BrowserWindow({ width: 390, height: 844, show: true });
      void phoneWindow.loadURL(url);
    }, pairing.url);
    const phone = await phonePromise;
    await phone.setViewportSize({ width: 390, height: 844 });

    await phone.getByLabel("페어링 코드").fill(pairing.code.toLowerCase());
    await phone.getByRole("button", { name: "연결" }).click();
    const sessionButton = phone.locator(".m-session").first();
    await expect(sessionButton).toBeVisible();
    await expect(phone.getByRole("heading", { name: "Sample Project" })).toBeVisible();

    // 같은 코드는 두 번 못 쓴다.
    const reuse = await phone.evaluate(
      async (code) => (await fetch("/pair", { method: "POST", body: JSON.stringify({ code, deviceName: "x" }) })).status,
      pairing.code,
    );
    expect(reuse).toBe(401);

    await sessionButton.click();
    await expect(phone.locator(".m-terminal .xterm-rows")).toBeVisible();
    await phone.getByLabel("입력").fill(WINDOWS ? "Write-Output MCW_FROM_PHONE" : "echo MCW_FROM_PHONE");
    await phone.getByRole("button", { name: "전송" }).click();
    await expect(phone.locator(".m-terminal .xterm-rows")).toContainText("MCW_FROM_PHONE");
    await expect(page.locator(".xterm-rows")).toContainText("MCW_FROM_PHONE");

    // 폰 크기로 맞춘 뒤에도 손가락 드래그로 스크롤백을 거슬러 올라갈 수 있다.
    await phone.getByLabel("입력").fill(
      WINDOWS ? "1..120 | ForEach-Object { 'MCW_TOUCH_' + $_ }" : "i=1; while [ $i -le 120 ]; do echo MCW_TOUCH_$i; i=$((i+1)); done",
    );
    await phone.getByRole("button", { name: "전송" }).click();
    await expect(phone.locator(".m-terminal .xterm-rows")).toContainText("MCW_TOUCH_120");
    await phone.getByRole("button", { name: "📱 폰 크기로" }).click();
    await expect(phone.getByRole("button", { name: "📱 폰 크기로" })).toHaveAttribute("aria-pressed", "true");
    const firstTouchRow = phone.locator(".m-terminal .xterm-rows > div").filter({ hasText: /^MCW_TOUCH_1$/ });
    await expect(firstTouchRow).toBeHidden();
    const box = await phone.locator(".m-terminal").boundingBox();
    if (!box) throw new Error("phone terminal is not on screen");
    const cdp = await phone.context().newCDPSession(phone);
    const x = box.x + box.width / 2;
    for (let drag = 0; drag < 6; drag += 1) {
      const top = box.y + 20;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: top }] });
      for (let step = 1; step <= 10; step += 1) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: top + step * ((box.height - 40) / 10) }] });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    await expect(firstTouchRow).toBeVisible();

    // 전체 화면 앱(claude)에는 스크롤백이 없다 — 드래그가 휠 입력으로 바뀌어 앱에 닿아야 한다.
    const dragDown = async () => {
      const area = await phone.locator(".m-terminal").boundingBox();
      if (!area) throw new Error("phone terminal is not on screen");
      const startY = area.y + 20;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: startY }] });
      for (let step = 1; step <= 10; step += 1) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: startY + step * ((area.height - 40) / 10) }] });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    await phone.getByLabel("입력").fill(`node "${mouseScript}"`);
    await phone.getByRole("button", { name: "전송" }).click();
    await expect(phone.locator(".m-terminal .xterm-rows")).toContainText("MCW_ALT_READY");
    // 폰이 PC로 보내는 입력을 엿본다 — "앱이 받았는가"가 아니라 "폰이 스크롤 입력을 보냈는가"로 확인한다.
    // Linux PTY는 마우스 모드 요청을 그대로 넘기므로 xterm이 SGR 휠(ESC[<64;…)을 보낸다. Windows ConPTY는
    // raw 모드 node가 켠 마우스 모드를 삼켜서(claude처럼 VT 입력을 켜야 넘긴다) xterm이 전체 화면용
    // 위 화살표(ESC[A)로 대신 보낸다. 둘 다 "드래그가 앱의 스크롤 입력이 됐다"는 뜻이다.
    const wheelInput = WINDOWS ? /\u001b\[<64;|\u001b\[A/ : /\u001b\[<64;/;
    await phone.evaluate(() => {
      const sent: string[] = [];
      (window as unknown as { __mcwSent: string[] }).__mcwSent = sent;
      const original = WebSocket.prototype.send;
      WebSocket.prototype.send = function (this: WebSocket, data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        if (typeof data === "string") sent.push(data);
        return original.call(this, data);
      };
    });
    await dragDown();
    await expect
      .poll(async () => {
        const writes = await phone.evaluate(() =>
          (window as unknown as { __mcwSent: string[] }).__mcwSent
            .map((message) => JSON.parse(message) as { type: string; data?: string })
            .filter((message) => message.type === "write")
            .map((message) => message.data ?? ""),
        );
        return writes.some((data) => wheelInput.test(data));
      })
      .toBe(true);
    await phone.getByLabel("입력").fill("q");
    await phone.getByRole("button", { name: "전송" }).click();

    // 철회하면 폰은 페어링 화면으로 돌아간다.
    const devices = await page.evaluate(() => window.multiCliWork.remote.listDevices());
    expect(devices).toHaveLength(1);
    await page.evaluate((deviceId) => window.multiCliWork.remote.revokeDevice(deviceId), devices[0]!.deviceId);
    await expect(phone.getByText("이 기기의 연결이 해제되었습니다. 다시 페어링하세요.")).toBeVisible();
  });
});
