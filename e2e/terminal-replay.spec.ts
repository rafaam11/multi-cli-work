import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import WebSocket from "ws";
import { sizeMarker } from "../src/shared/terminal-replay";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const SAVED = "22222222-2222-4222-8222-222222222222";
let root: string;
let app: ElectronApplication;
let page: Page;
let port: number;

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function launch(): Promise<void> {
  app = await electron.launch({ args: [path.join(root, "entry.cjs")], env: {
    ...process.env,
    MULTI_CLI_WORK_USER_DATA: path.join(root, "user-data"),
    MULTI_CLI_WORK_REGISTRY_PATH: path.join(root, "projects.json"),
    MULTI_CLI_WORK_AGENTS_PATH: path.join(root, "agents.json"),
    MULTI_CLI_WORK_CODEX_SESSIONS_DIR: path.join(root, "codex-sessions"),
    MULTI_CLI_WORK_WORK_PROJECTS_PATH: path.join(root, "work-projects.json"),
    MULTI_CLI_WORK_WORKTREES_PATH: path.join(root, "worktrees.json"),
    MULTI_CLI_WORK_WORKTREE_SCRIPTS_PATH: path.join(root, "worktree-scripts.json"),
    MULTI_CLI_WORK_CLAUDE_CONFIG_DIR: path.join(root, "claude-config"),
    MULTI_CLI_WORK_PR_REVIEWS_PATH: path.join(root, "reviews.json"),
    MULTI_CLI_WORK_WORKSPACE_PATH: path.join(root, "workspace.json"),
    MULTI_CLI_WORK_PROJECT_TAGS_PATH: path.join(root, "tags.json"),
    MULTI_CLI_WORK_REMOTE_BIND: "127.0.0.1",
  } });
  page = await app.firstWindow();
  await page.getByRole("button", { name: "Replay Test 폴더 선택" }).click();
}

async function close(): Promise<void> {
  if (!app) return;
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await app.close();
}

const pane = (name: string) => page.locator(`.grid-pane[aria-label="${name}"]`);
const rows = (name: string) => pane(name).locator(".xterm-rows");
const lines = (name: string) => rows(name).locator(":scope > div").allTextContents();
async function screenshot(name: string): Promise<void> {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
}

test.beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-replay-e2e-"));
  port = await freePort();
  const now = new Date().toISOString();
  await fs.mkdir(path.join(root, "user-data", "session-logs"), { recursive: true });
  await fs.writeFile(path.join(root, "entry.cjs"),
    `const { BrowserWindow, ipcMain } = require('electron');
const show = BrowserWindow.prototype.show;
global.showReplayWindow = window => show.call(window);
global.replayCalls = [];
const handle = ipcMain.handle;
ipcMain.handle = function(channel, listener) {
  return handle.call(this, channel, (...args) => {
    if (['terminals:resize', 'terminals:repaint', 'terminals:write', 'terminals:refresh'].includes(channel)) {
      global.replayCalls.push({ channel, args: args.slice(1) });
    }
    return listener(...args);
  });
};
BrowserWindow.prototype.show = function() {};
BrowserWindow.prototype.showInactive = function() {};
require(${JSON.stringify(path.resolve("out/main/index.js"))});`);
  await fs.writeFile(path.join(root, "projects.json"), JSON.stringify({ schemaVersion: 1, updatedAt: now, projects: {
    [PROJECT]: { id: PROJECT, rootPath: root, displayName: "Replay Test", sources: ["manual"],
      providerRefs: { claude: [], codex: [] }, status: null, memo: "", tracks: [], hidden: false,
      order: 0, createdAt: now, updatedAt: now },
  } }));
  await fs.writeFile(path.join(root, "user-data", "settings.json"), JSON.stringify({
    general: { autoResumeSessions: false, autoCheckUpdates: false, repoSyncOnSessionStart: false },
    remote: { enabled: true, port }, usage: { enabled: false },
  }));
  await fs.writeFile(path.join(root, "fixture.cjs"), String.raw`
const fs = require('node:fs');
process.stdout.write('\x1b[?1049h\x1b[?2004h');
function draw() {
  const cols = process.stdout.columns;
  const rows = process.stdout.rows;
  let frame = '\x1b[H\x1b[2J';
  for (let r = 1; r < rows; r++) {
    const label = 'ROW_' + String(r).padStart(2, '0');
    frame += '\x1b[' + r + ';1H' + label + '.'.repeat(Math.max(0, cols - label.length - 5)) + 'EDGE';
  }
  process.stdout.write(frame + '\x1b[H');
}
process.stdout.on('resize', draw);
process.stdin.setRawMode(true);
process.stdin.on('data', data => fs.appendFileSync(__dirname + '/input.txt', data));
draw();
`);
  await fs.writeFile(path.join(root, "agents.json"), JSON.stringify({ schemaVersion: 1, updatedAt: now, agents: {
    "replay-fixture": { id: "replay-fixture", label: "Replay Fixture", commands: ["node"],
      args: [path.join(root, "fixture.cjs")], conversationId: "none", statusAdapter: "signals", accentColor: "#4285f4" },
  } }));
});

test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus && page && !page.isClosed()) {
    await screenshot("failure");
    console.error(await page.locator("body").innerText());
  }
  await close();
  if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("mcw-replay-e2e-")) {
    throw new Error("Refusing to remove an unexpected fixture directory");
  }
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("restores an exited multi-size alternate screen after restart and layout changes", async () => {
  const now = new Date().toISOString();
  await fs.writeFile(path.join(root, "user-data", "state.json"), JSON.stringify({
    schemaVersion: 1, updatedAt: now, selectedProjectId: PROJECT, selectedSessionId: SAVED,
    sessions: { [SAVED]: { id: SAVED, projectId: PROJECT, tool: null, kind: "replay-fixture", cwd: root,
      title: null, name: "Saved", providerConversationId: null, interruptedByShutdown: true, createdAt: now, updatedAt: now } },
    folderViews: { [PROJECT]: { layoutId: "single", slots: [SAVED] } },
  }));
  const replay = sizeMarker(120, 40) + '\x1b[?1049h\x1b[?2004h\x1b[HOLD' +
    '\x1b[2' + sizeMarker(100, 30) + 'J\x1b[1;1H' + 'SAVED_FRAME' + '\x1b[2;90HEDGE';
  await fs.writeFile(path.join(root, "user-data", "session-logs", `${SAVED}.log`), replay);
  await launch();
  const assertFrame = async () => {
    await expect(rows("Saved")).toContainText("SAVED_FRAME");
    const screen = await lines("Saved");
    expect(screen[0].trim()).toBe("SAVED_FRAME");
    expect(screen[1].replace(/\u00a0/g, " ").indexOf("EDGE")).toBe(89);
    expect(await page.evaluate(async (id) => (await window.multiCliWork.terminals.list()).find(s => s.id === id)?.pid, SAVED)).toBeNull();
  };
  await assertFrame();
  await page.setViewportSize({ width: 1500, height: 950 });
  await assertFrame();
  await screenshot("saved-sized-frame");
  await expect.poll(() => page.evaluate(() => window.multiCliWork.remote.status().then(s => s.state))).toBe("listening");
  const pairing = await page.evaluate(() => window.multiCliWork.remote.issuePairingCode());
  const phonePromise = app.waitForEvent("window");
  await app.evaluate(({ BrowserWindow }, url) => {
    const phone = new BrowserWindow({ width: 390, height: 844, show: false });
    void phone.loadURL(url);
  }, pairing.url);
  const phone = await phonePromise;
  try {
    await phone.getByLabel("페어링 코드").fill(pairing.code);
    await phone.getByRole("button", { name: "연결", exact: true }).click();
    await phone.locator(".m-row-open").first().click();
    await expect(phone.locator(".xterm-rows")).toContainText("SAVED_FRAME");
    const phoneLines = await phone.locator(".xterm-rows > div").allTextContents();
    expect(phoneLines[0].trim()).toBe("SAVED_FRAME");
    expect(phoneLines[1].replace(/\u00a0/g, " ").indexOf("EDGE")).toBe(89);
    await phone.screenshot({ path: test.info().outputPath("mobile-sized-frame.png") });
  } finally { await phone.close(); }
  await close();
  await launch();
  await assertFrame();
});

test("keeps a live TUI intact through resizing, zoom, reattach, paste and phone-owned focus return", async () => {
  test.setTimeout(90_000);
  await launch();
  const live = await page.evaluate((projectId) => window.multiCliWork.terminals.create({
    projectId, kind: "replay-fixture", cols: 120, rows: 40, name: "Live",
  }), PROJECT);
  await page.getByRole("button", { name: "Live 세션 열기", exact: true }).click();
  await expect(rows("Live")).toContainText("ROW_01");
  await page.evaluate((projectId) => window.multiCliWork.terminals.create({
    projectId, kind: "replay-fixture", cols: 120, rows: 40, name: "Peer",
  }), PROJECT);
  await page.getByRole("button", { name: "Peer 세션 열기", exact: true }).click();
  await page.locator(".layout-bar").getByRole("radio", { name: "2열", exact: true }).click();
  const assertFrame = async () => {
    await expect.poll(async () => {
      const screen = (await lines("Live")).map(line => line.replace(/\u00a0/g, " "));
      return screen.slice(0, 5).every((line, i) => line.startsWith(`ROW_0${i + 1}`) && line.endsWith("EDGE "));
    }).toBe(true);
  };
  await assertFrame();
  await page.setViewportSize({ width: 1500, height: 950 });
  await assertFrame();
  const divider = (await page.getByRole("separator", { name: "폴더 사이드바 크기 조절" }).boundingBox())!;
  await page.mouse.move(divider.x + divider.width / 2, divider.y + 80);
  await page.mouse.down();
  await page.mouse.move(divider.x + 80, divider.y + 80, { steps: 5 });
  await page.mouse.up();
  await assertFrame();
  await pane("Live").getByRole("button", { name: "패인 확대", exact: true }).click();
  await assertFrame();
  await expect(pane("Peer")).toHaveClass(/grid-pane-parked/);
  await pane("Live").getByRole("button", { name: "확대 해제", exact: true }).click();
  await assertFrame();
  await page.getByRole("button", { name: "홈 대시보드 열기" }).click();
  await page.getByRole("button", { name: "Replay Test 폴더 선택" }).click();
  await assertFrame();
  await page.evaluate(() => { window.dispatchEvent(new Event("blur")); window.dispatchEvent(new Event("focus")); });
  await assertFrame();
  await app.evaluate(({ clipboard }) => { clipboard.readText = () => "PASTE_FIRST\nPASTE_SECOND"; });
  await pane("Live").locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Control+Shift+V");
  await expect.poll(() => fs.readFile(path.join(root, "input.txt"), "utf8").catch(() => ""))
    .toContain("\x1b[200~PASTE_FIRST\rPASTE_SECOND\x1b[201~");

  // Showing the hidden harness can change the client area. Let that layout settle before the
  // phone claims its size, so the later check measures focus alone.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: false });
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows()[0];
    (globalThis as unknown as { showReplayWindow(w: Electron.BrowserWindow): void }).showReplayWindow(main);
    main.focus();
  });
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
  await page.waitForTimeout(200);
  // Keep xterm focused: its native focus reports must reach the PTY without reclaiming size.
  await pane("Live").locator(".xterm-helper-textarea").focus();
  await expect.poll(() => page.evaluate(() => window.multiCliWork.remote.status().then(s => s.state))).toBe("listening");
  const pairing = await page.evaluate(() => window.multiCliWork.remote.issuePairingCode());
  const paired = await fetch(`http://127.0.0.1:${port}/pair`, { method: "POST", body: JSON.stringify({ code: pairing.code, deviceName: "Test Phone" }) }).then(r => r.json());
  const phone = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  try {
    await new Promise<void>((resolve) => phone.once("open", resolve));
    const messages: Array<Record<string, unknown>> = [];
    phone.on("message", data => messages.push(JSON.parse(String(data))));
    phone.send(JSON.stringify({ type: "hello", protocolVersion: 1, mode: "ui", token: paired.token }));
    await expect.poll(() => messages.some(m => m.type === "welcome")).toBe(true);
    phone.send(JSON.stringify({ type: "attach", sessionId: live.id }));
    await expect.poll(() => messages.some(m => m.type === "attached")).toBe(true);
    phone.send(JSON.stringify({ type: "resize", sessionId: live.id, cols: 45, rows: 30 }));
    await expect.poll(() => messages.filter(m => m.type === "size").at(-1)?.cols).toBe(45);
    // Exercise native window blur/focus as well as the renderer event path above.
    await page.evaluate(() => {
      (window as unknown as { focusReturns: number }).focusReturns = 0;
      window.addEventListener("focus", () => { (window as unknown as { focusReturns: number }).focusReturns++; });
    });
    await app.evaluate(() => { (globalThis as unknown as { replayCalls: unknown[] }).replayCalls = []; });
    await app.evaluate(({ BrowserWindow }) => {
      const other = new BrowserWindow({ width: 320, height: 200, show: false });
      other.setTitle("Replay focus fixture");
      void other.loadURL("data:text/html,<title>Replay focus fixture</title>Focus fixture");
      (globalThis as unknown as { showReplayWindow(w: Electron.BrowserWindow): void }).showReplayWindow(other);
      other.focus();
    });
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(false);
    const focusReturns = await page.evaluate(() => (window as unknown as { focusReturns: number }).focusReturns);
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find(w => w.getTitle() !== "Replay focus fixture")!.focus();
    });
    await expect.poll(() => page.evaluate(() => (window as unknown as { focusReturns: number }).focusReturns)).toBeGreaterThan(focusReturns);
    await page.waitForTimeout(120);
    const calls = await app.evaluate(() => (globalThis as unknown as { replayCalls: Array<{channel: string; args: unknown[]}> }).replayCalls);
    expect(calls.filter(call => call.channel === "terminals:resize"), JSON.stringify(calls)).toEqual([]);
    expect(calls).toContainEqual({ channel: "terminals:repaint", args: [live.id] });
    expect(await page.evaluate(() => window.multiCliWork.terminals.sizeOwners()), JSON.stringify(calls)).toContainEqual({ sessionId: live.id, deviceName: "Test Phone" });
    expect(messages.filter(m => m.type === "size").at(-1)).toMatchObject({ cols: 45, rows: 30, sizeOwner: paired.deviceId });
    await screenshot("live-phone-size-preserved");
    await app.evaluate(() => { (globalThis as unknown as { replayCalls: unknown[] }).replayCalls = []; });
    await page.getByRole("button", { name: "화면 새로고침", exact: true }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { replayCalls: Array<{channel: string}> }).replayCalls.filter(call => call.channel === "terminals:refresh").length)).toBe(2);
    await expect(rows("Live")).toContainText("ROW_01");
    await page.waitForTimeout(150);
    const reloadCalls = await app.evaluate(() => (globalThis as unknown as { replayCalls: unknown[] }).replayCalls);
    expect(await page.evaluate(() => window.multiCliWork.terminals.sizeOwners()), JSON.stringify(reloadCalls)).toContainEqual({ sessionId: live.id, deviceName: "Test Phone" });
    await pane("Live").locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("HUMAN");
    await expect.poll(() => page.evaluate(() => window.multiCliWork.terminals.sizeOwners())).toEqual([]);
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find(w => w.getTitle() === "Replay focus fixture")?.destroy();
      BrowserWindow.getAllWindows()[0].hide();
    });
    await cdp.detach();
  } finally { phone.close(); }
});

test("keeps the tail of a full restored log after auto-resume produces new PTY output", async () => {
  test.setTimeout(60_000);
  const now = new Date().toISOString();
  await fs.writeFile(path.join(root, "user-data", "settings.json"), JSON.stringify({
    general: { autoResumeSessions: true, autoCheckUpdates: false, repoSyncOnSessionStart: false }, usage: { enabled: false },
  }));
  await fs.writeFile(path.join(root, "user-data", "state.json"), JSON.stringify({
    schemaVersion: 1, updatedAt: now, selectedProjectId: PROJECT, selectedSessionId: SAVED,
    sessions: { [SAVED]: { id: SAVED, projectId: PROJECT, tool: null, kind: "replay-fixture", cwd: root,
      title: null, name: "Restored", providerConversationId: null, interruptedByShutdown: true, createdAt: now, updatedAt: now } },
    folderViews: { [PROJECT]: { layoutId: "single", slots: [SAVED] } },
  }));
  await fs.writeFile(path.join(root, "user-data", "session-logs", `${SAVED}.log`),
    sizeMarker(120, 40) + "x".repeat(5 * 1024 * 1024) + "\r\nPERSIST_TAIL\r\n");
  await launch();
  await expect(rows("Restored")).toContainText("ROW_01");
  const restored = await page.evaluate(async id => window.multiCliWork.terminals.attach(id), SAVED);
  expect(restored.session.pid).not.toBeNull();
  expect(restored.replay).toContain("PERSIST_TAIL");
  expect(restored.replay).toContain("ROW_01");
  await page.setViewportSize({ width: 1500, height: 950 });
  await expect.poll(() => page.evaluate(async id => (await window.multiCliWork.terminals.attach(id)).replay, SAVED)).toContain("PERSIST_TAIL");
  await screenshot("restored-log-tail");
});
