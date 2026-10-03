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
const echo = (text: string) => (WINDOWS ? `Write-Output ${text}` : `echo ${text}`);

let tempRoot: string;
let app: ElectronApplication;
let page: Page;
let port: number;

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
 * 앱 하나가 호스트이자 클라이언트다: 원격 서버를 loopback에 띄우고(MULTI_CLI_WORK_REMOTE_BIND),
 * 자기 자신을 원격 PC로 등록해 원격 창을 연다. 메인 창이 "호스트 PC의 화면" 역할도 한다.
 */
test.describe.serial("Remote PC window", () => {
  test.beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "multi-cli-work-remote-e2e-"));
    port = await freePort();
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
    // 호스트 토큰은 safeStorage로 암호화해 저장하고, 암호화할 수 없으면 등록을 거부한다. Linux CI 러너
    // 에는 OS 키링이 없어 그 거부에 걸린다 — 실제 데스크톱에는 gnome-keyring 같은 것이 있다. 여기서는
    // Electron이 주는 대체 모드(메모리 키)를 켜서 저장 경로를 지나가게 한다. Windows에서는 아무 일도 없다.
    await app.evaluate(({ safeStorage }) => {
      (safeStorage as unknown as { setUsePlainTextEncryption?: (use: boolean) => void }).setUsePlainTextEncryption?.(true);
    });
  });

  test.afterAll(async () => {
    await app?.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    }).catch(() => undefined);
    await app?.close().catch(() => undefined);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  test("registers a host, works in its session from a remote window, and loses it on revoke", async () => {
    await expect(page.getByRole("heading", { name: "멀티 터미널 작업기" })).toBeVisible();
    await page.getByRole("button", { name: "Sample Project 폴더 선택" }).click();
    await page.getByRole("button", { name: `새 ${SHELL_LABEL} 세션` }).click();
    const hostTerminal = page.getByRole("region", { name: `${SHELL_ID} 터미널` });
    await expect(hostTerminal).toBeVisible();

    await expect
      .poll(() => page.evaluate(() => window.multiCliWork.remote.status().then((status) => status.state)))
      .toBe("listening");

    // 등록 전에는 사이드바에 원격 PC 섹션이 없다.
    const hostsSection = page.getByRole("region", { name: "원격 PC" });
    await expect(hostsSection).toHaveCount(0);

    // Tailscale 밖 주소는 loopback 실행이라도 받지 않는다.
    const pairing = await page.evaluate(() => window.multiCliWork.remote.issuePairingCode());
    const refused = await page.evaluate(
      (code) => window.multiCliWork.remoteHosts.add({ address: "192.168.0.5:47821", code }).then(() => "ok", (error: Error) => error.message),
      pairing.code,
    );
    expect(refused).toContain("Tailscale 주소");

    const added = await page.evaluate(
      (input) => window.multiCliWork.remoteHosts.add(input),
      { address: `127.0.0.1:${port}`, code: pairing.code },
    );
    expect(added.paired).toBe(true);
    const hostButton = hostsSection.getByRole("button", { name: added.name });
    await expect(hostButton).toBeVisible();
    // 원격 창을 열지 않아도 상태 연결이 붙는다 — 알림과 대기 수가 이 연결에서 온다.
    await expect(hostButton.getByLabel("연결됨")).toBeVisible();
    // 토큰은 암호문으로만 저장된다(이 PC가 호스트이기도 해서 기기 목록에 자기 이름이 보인다).
    const devices = await page.evaluate(() => window.multiCliWork.remote.listDevices());
    expect(devices).toHaveLength(1);
    const stored = await fs.readFile(path.join(tempRoot, "user-data", "remote-hosts.json"), "utf8");
    expect(JSON.parse(stored).hosts[0].token).toEqual(expect.any(String));

    // 원격 창: 넓은 화면 2단, 셸 브리지로 페어링 화면 없이 바로 목록.
    const remotePromise = app.waitForEvent("window");
    await hostButton.click();
    const remote = await remotePromise;
    // 원격 창을 호스트 패인보다 작게 둔다 — 호스트는 큰 모니터, 이쪽은 노트북인 흔한 구성.
    await remote.setViewportSize({ width: 920, height: 620 });
    await expect(remote.locator(".m-wide")).toBeVisible();
    await expect(remote.getByLabel("페어링 코드")).toHaveCount(0);
    expect(await remote.evaluate(() => typeof (window as unknown as { multiCliWork?: unknown }).multiCliWork)).toBe("undefined");

    const sessionButton = remote.locator(".m-session").first();
    await sessionButton.click();
    await expect(sessionButton).toHaveAttribute("aria-current", "true");
    const remoteRows = remote.locator(".m-terminal .xterm-rows");
    await expect(remoteRows).toBeVisible();
    // 넓은 화면에서는 입력창이 접혀 있고 키보드가 터미널로 바로 간다.
    await expect(remote.getByLabel("입력")).toHaveCount(0);
    await remote.keyboard.type(echo("MCW_FROM_PC"));
    await remote.keyboard.press("Enter");
    await expect(remoteRows).toContainText("MCW_FROM_PC");
    await expect(page.locator(".xterm-rows")).toContainText("MCW_FROM_PC");

    // 자동 맞춤: 원격 창이 크기를 가져갔다가, 호스트에서 입력하면 내주고 멈춘다.
    const keepHost = remote.getByRole("button", { name: "호스트 크기 유지" });
    await expect(keepHost).toHaveAttribute("aria-pressed", "false");
    await expect(remote.getByText("호스트가 크기를 가져갔습니다")).toHaveCount(0);
    await hostTerminal.click();
    await page.keyboard.type(echo("MCW_FROM_HOST"));
    await page.keyboard.press("Enter");
    await expect(remote.getByText("호스트가 크기를 가져갔습니다")).toBeVisible();
    await expect(remoteRows).toContainText("MCW_FROM_HOST");
    // 호스트 크기로 그려진 터미널이 이 창을 넘쳐 스크롤바가 생겨도, 그것을 창 크기 변경으로 보고
    // 크기를 도로 가져가면 안 된다 — 멈춘 채로 있어야 한다.
    await remote.waitForTimeout(1_000);
    await expect(remote.getByText("호스트가 크기를 가져갔습니다")).toBeVisible();
    // 사용자가 창 크기를 바꾸면 다시 맞춘다.
    await remote.setViewportSize({ width: 960, height: 640 });
    await expect(remote.getByText("호스트가 크기를 가져갔습니다")).toHaveCount(0);
    // 호스트가 또 되찾으면 다시 멈추고, 버튼으로도 다시 맞출 수 있다.
    await hostTerminal.click();
    await page.keyboard.type(echo("MCW_HOST_AGAIN"));
    await page.keyboard.press("Enter");
    await expect(remote.getByText("호스트가 크기를 가져갔습니다")).toBeVisible();
    await remote.getByRole("button", { name: "다시 맞추기" }).click();
    await expect(remote.getByText("호스트가 크기를 가져갔습니다")).toHaveCount(0);

    // 붙여넣기: 이 PC의 클립보드가 브라우저 paste 이벤트로 xterm에 들어간다.
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), echo("MCW_PASTED"));
    await remote.locator(".m-terminal").click();
    await remote.keyboard.press("Control+V");
    await remote.keyboard.press("Enter");
    await expect(remoteRows).toContainText("MCW_PASTED");

    // 복사: 출력 줄의 낱말을 두 번 눌러 고르고 Ctrl+Shift+C. 줄 한가운데는 빈칸이라 글자가 있는 왼쪽을 누른다.
    await app.evaluate(({ clipboard }) => clipboard.writeText(""));
    // xterm의 화면 레이어가 줄 요소를 덮고 있어서 요소가 아니라 좌표로 누른다.
    const pastedRow = await remoteRows.locator("> div").filter({ hasText: /^MCW_PASTED$/ }).last().boundingBox();
    if (!pastedRow) throw new Error("pasted output row is not on screen");
    await remote.mouse.dblclick(pastedRow.x + 20, pastedRow.y + pastedRow.height / 2);
    await remote.keyboard.press("Control+Shift+C");
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain("MCW_PASTED");

    // 세션 관리: 원격 창에서 새 세션을 띄우고 중지·재시작·삭제한다. 호스트 화면의 선택은 그대로다.
    const hostSessions = () => page.evaluate(() => window.multiCliWork.terminals.list());
    const hostSelection = () =>
      page.evaluate(() => window.multiCliWork.terminals.state().then((snapshot) => snapshot.state.selectedSessionId));
    const selectedBefore = await hostSelection();
    await remote.getByRole("button", { name: "새 세션" }).click();
    await remote.getByLabel("폴더").selectOption({ label: "Sample Project" });
    await remote.getByLabel("에이전트").selectOption({ label: SHELL_LABEL });
    await remote.getByRole("button", { name: "시작" }).click();
    await expect(remote.locator(".m-session")).toHaveCount(2);
    await expect.poll(async () => (await hostSessions()).length).toBe(2);
    expect(await hostSelection()).toBe(selectedBefore);

    // 만든 쪽에서 바로 열린다.
    const screenStatus = remote.locator(".m-session-screen .m-bar .m-status");
    await expect(remote.getByRole("button", { name: "중지" })).toBeVisible();
    await remote.locator(".m-terminal").click();
    await remote.keyboard.type(echo("MCW_NEW_SESSION"));
    await remote.keyboard.press("Enter");
    await expect(remoteRows).toContainText("MCW_NEW_SESSION");

    await remote.getByRole("button", { name: "중지" }).click();
    await expect(remote.getByRole("button", { name: "재시작" })).toBeVisible();
    await expect(screenStatus).toHaveText("종료됨");
    await expect.poll(async () => (await hostSessions()).filter((session) => session.status === "exited").length).toBe(1);

    // 다시 시작한 프로세스의 출력이 이 화면에 이어서 나온다(다시 붙었다는 뜻).
    await remote.getByRole("button", { name: "재시작" }).click();
    await expect(remote.getByRole("button", { name: "중지" })).toBeVisible();
    await remote.locator(".m-terminal").click();
    await remote.keyboard.type(echo("MCW_AFTER_RESTART"));
    await remote.keyboard.press("Enter");
    await expect(remoteRows).toContainText("MCW_AFTER_RESTART");
    expect(await hostSelection()).toBe(selectedBefore);

    // 재시작을 요청하지 않은 화면도 이어 받는다: 이번에는 호스트 쪽에서 다시 시작한다.
    await remote.getByRole("button", { name: "중지" }).click();
    await expect(remote.getByRole("button", { name: "재시작" })).toBeVisible();
    const stopped = (await hostSessions()).find((session) => session.status === "exited");
    if (!stopped) throw new Error("the stopped session is missing on the host");
    await page.evaluate(
      (sessionId) => window.multiCliWork.terminals.resume({ sessionId, cols: 80, rows: 24 }),
      stopped.id,
    );
    await expect(remote.getByRole("button", { name: "중지" })).toBeVisible();
    await remote.locator(".m-terminal").click();
    await remote.keyboard.type(echo("MCW_HOST_RESTARTED"));
    await remote.keyboard.press("Enter");
    await expect(remoteRows).toContainText("MCW_HOST_RESTARTED");

    await remote.getByRole("button", { name: "삭제" }).click();
    await remote.getByRole("button", { name: "정말 삭제" }).click();
    await expect(remote.locator(".m-session")).toHaveCount(1);
    await expect.poll(async () => (await hostSessions()).length).toBe(1);
    // 지운 세션에서 떼어 나오는 것은 실패가 아니다 — 거절 알림이 뜨면 안 된다.
    await remote.waitForTimeout(500);
    await expect(remote.getByRole("alert")).toHaveCount(0);

    // 호스트가 이 기기를 철회하면 원격 창이 닫히고 다시 페어링해야 한다.
    const closed = remote.waitForEvent("close");
    await page.evaluate((deviceId) => window.multiCliWork.remote.revokeDevice(deviceId), devices[0]!.deviceId);
    await closed;
    await expect(hostsSection.getByText("다시 페어링 필요")).toBeVisible();
    // 상태 연결도 같은 토큰이라 함께 끊기고, 다시 붙으려 하지 않는다.
    await expect(hostsSection.getByRole("img")).toHaveCount(0);
    const reopen = await page.evaluate(
      (hostId) => window.multiCliWork.remoteHosts.open(hostId).then(() => "ok", (error: Error) => error.message),
      added.hostId,
    );
    expect(reopen).toContain("다시 페어링");
  });
});
