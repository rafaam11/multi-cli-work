import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * What a split column does to the rest of the grid, read off the screen rather than the state.
 * `a/b` is one column's two rows, `|` a column boundary, `_` an empty slot.
 */

const PROJECT = "11111111-1111-4111-8111-111111111111";
const FOLDER_BUTTON = "Split Test 폴더 선택";
const NEW_SESSION = "Split Fixture";

type View = { layoutId: string; slots: (string | null)[] };
let root: string;
let app: ElectronApplication;
let page: Page;

const view = (layoutId: string, ...slots: (string | null)[]): View => ({ layoutId, slots });
const namesIn = (...views: View[]): string[] => views.flatMap((item) => item.slots).filter((id): id is string => id !== null);

async function launch(seed: { folder?: View; workspace?: View; hidden?: View }): Promise<void> {
  const now = new Date().toISOString();
  const shelves = [seed.workspace, seed.hidden].filter((item): item is View => item !== undefined);
  const names = [...new Set(namesIn(...shelves, ...(seed.folder ? [seed.folder] : [])))];
  const workspace = seed.workspace ?? seed.folder ?? view("auto");
  await fs.writeFile(path.join(root, "user-data", "state.json"), JSON.stringify({
    schemaVersion: 1, updatedAt: now, selectedProjectId: PROJECT, selectedSessionId: names[0] ?? null,
    folderViews: seed.folder ? { [PROJECT]: seed.folder } : {},
    workspace,
    ...(seed.hidden ? { hiddenPanes: seed.hidden } : {}),
    sessions: Object.fromEntries(names.map((id) => [id, {
      id, projectId: PROJECT, tool: null, title: null, name: id,
      kind: process.platform === "win32" ? "powershell" : "bash",
      cwd: root, providerConversationId: null, interruptedByShutdown: false, createdAt: now, updatedAt: now,
    }])),
  }));
  app = await electron.launch({
    args: [path.join(root, "entry.cjs")],
    env: {
      ...process.env,
      MULTI_CLI_WORK_USER_DATA: path.join(root, "user-data"),
      ...Object.fromEntries([
        ["REGISTRY_PATH", "projects.json"], ["WORKSPACE_PATH", "workspace.json"],
        ["AGENTS_PATH", "agents.json"], ["WORK_PROJECTS_PATH", "work-projects.json"],
        ["WORKTREES_PATH", "worktrees.json"], ["WORKTREE_SCRIPTS_PATH", "scripts.json"],
        ["PROJECT_TAGS_PATH", "tags.json"], ["PR_REVIEWS_PATH", "reviews.json"],
        ["CLAUDE_CONFIG_DIR", "claude-config"], ["CLAUDE_PROJECTS_DIR", "claude-projects"],
        ["CODEX_SESSIONS_DIR", "codex-sessions"],
      ].map(([key, name]) => [`MULTI_CLI_WORK_${key}`, path.join(root, name)])),
    },
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1500, height: 950 });
}

const openFolder = () => page.getByRole("button", { name: FOLDER_BUTTON }).click();
/** The count in the name is what waits for the saved state: pressed earlier, its restore undoes the press. */
const openWorkspace = (panes: number) =>
  page.getByRole("button", { name: `세션 작업공간 열기 (패인 ${panes}개)`, exact: true }).click();
const pane = (name: string) => page.locator(`.grid-pane[aria-label="${name}"]`);
const closeButton = (name: string) => pane(name).getByRole("button", { name: "슬롯 비우기", exact: true });
const splitButton = (name: string) => pane(name).getByRole("button", { name: "열 세로분할", exact: true });
const mergeButton = (name: string) => pane(name).getByRole("button", { name: "열 분할 해제", exact: true });

/** The grid as drawn: slots sharing a left edge are one column, in slot order. */
async function shape(): Promise<string> {
  return page.evaluate(() => {
    const cells = [...document.querySelectorAll<HTMLElement>(".workspace-grid [data-slot]")]
      .sort((a, b) => Number(a.dataset.slot) - Number(b.dataset.slot));
    const columns = new Map<number, string[]>();
    for (const cell of cells) {
      const left = Math.round(cell.getBoundingClientRect().left);
      const label = cell.classList.contains("empty") ? "_" : cell.getAttribute("aria-label") ?? "?";
      columns.set(left, [...(columns.get(left) ?? []), label]);
    }
    return [...columns.values()].map((column) => column.join("/")).join("|");
  });
}

async function expectShape(expected: string, screenshotName: string): Promise<void> {
  await expect.poll(shape).toBe(expected);
  await page.screenshot({ path: test.info().outputPath(`${screenshotName}.png`) });
}

/**
 * The platform's drag machinery cannot be driven from here, so the events a drop is made of are
 * dispatched by hand, aimed at the slot's centre so the grid's edge zones stay out of it.
 */
async function dragPane(name: string, slot: number, from: "grid" | "sidebar" = "grid"): Promise<void> {
  await page.evaluate(({ name, slot, from }) => {
    const source = from === "grid"
      ? document.querySelector<HTMLElement>(`.grid-pane[aria-label="${name}"] .pane-header`)
      : [...document.querySelectorAll<HTMLElement>(".workspace-shelf-panes .file-tab-row")]
          .find((row) => row.querySelector(".session-name")?.textContent === name);
    const target = document.querySelector<HTMLElement>(`.workspace-grid [data-slot="${slot}"]`);
    if (!source || !target) throw new Error(`drag ${name} to slot ${slot}: source or target missing`);
    const box = target.getBoundingClientRect();
    const dataTransfer = new DataTransfer();
    const fire = (element: HTMLElement, type: string) => element.dispatchEvent(new DragEvent(type, {
      bubbles: true, cancelable: true, dataTransfer,
      clientX: box.left + box.width / 2, clientY: box.top + box.height / 2,
    }));
    fire(source, "dragstart");
    fire(target, "dragover");
    fire(target, "drop");
    fire(source, "dragend");
  }, { name, slot, from });
}

/** Marks a pane's terminal, so a later check can tell it survived rather than was rebuilt. */
async function markTerminal(name: string): Promise<void> {
  await expect(pane(name).locator(".xterm")).toHaveCount(1);
  await pane(name).locator(".xterm").evaluate((element) => element.setAttribute("data-kept", "yes"));
}
const expectTerminalKept = (name: string) => expect(pane(name).locator('.xterm[data-kept="yes"]')).toHaveCount(1);

async function startSessionInEmptySlot(slot: number): Promise<void> {
  await page.locator(`.workspace-grid [data-slot="${slot}"] .grid-slot-new-session`).click();
  await page.getByRole("button", { name: `Split Test에서 ${NEW_SESSION} 시작`, exact: true })
    .or(page.getByRole("menuitem", { name: `Split Test에서 ${NEW_SESSION} 시작`, exact: true }))
    .click();
}

test.beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-split-e2e-"));
  const now = new Date().toISOString();
  await fs.mkdir(path.join(root, "user-data"), { recursive: true });
  await fs.writeFile(path.join(root, "entry.cjs"), `const { BrowserWindow } = require('electron');
BrowserWindow.prototype.show = function() {};
BrowserWindow.prototype.showInactive = function() {};
require(${JSON.stringify(path.resolve("out/main/index.js"))});`);
  await fs.writeFile(path.join(root, "projects.json"), JSON.stringify({ schemaVersion: 1, updatedAt: now, projects: {
    [PROJECT]: { id: PROJECT, rootPath: root, displayName: "Split Test", sources: ["manual"],
      providerRefs: { claude: [], codex: [] }, status: null, memo: "", tracks: [], hidden: false,
      order: 0, createdAt: now, updatedAt: now },
  } }));
  await fs.writeFile(path.join(root, "user-data", "settings.json"), JSON.stringify({
    general: { autoResumeSessions: false, autoCheckUpdates: false, repoSyncOnSessionStart: false },
    usage: { enabled: false },
  }));
  await fs.writeFile(path.join(root, "fixture.cjs"), "setInterval(() => {}, 1000);\n");
  await fs.writeFile(path.join(root, "agents.json"), JSON.stringify({ schemaVersion: 1, updatedAt: now, agents: {
    "split-fixture": { id: "split-fixture", label: NEW_SESSION, commands: ["node"],
      args: [path.join(root, "fixture.cjs")], conversationId: "none", statusAdapter: "signals", accentColor: "#4285f4" },
  } }));
});

test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus && page && !page.isClosed()) {
    await page.screenshot({ path: info.outputPath("failure.png") }).catch(() => undefined);
  }
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }).catch(() => undefined);
  await app.close().catch(() => undefined);
  if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("mcw-split-e2e-")) {
    throw new Error("Refusing to remove an unexpected fixture directory");
  }
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test.describe("a new session in a column's empty row", () => {
  for (const { title, slots, split, slot, expected } of [
    { title: "first column", slots: ["a", "b", "c"], split: "a", slot: 1, expected: `a/${NEW_SESSION}|b|c` },
    { title: "middle column", slots: ["a", "b", "c", "d"], split: "b", slot: 2, expected: `a|b/${NEW_SESSION}|c|d` },
  ]) {
    test(`stays in that row and moves nobody: ${title}`, async () => {
      await launch({ folder: view(`cols:${slots.map(() => 1).join("-")}`, ...slots) });
      await openFolder();
      await splitButton(split).click();
      await startSessionInEmptySlot(slot);
      await expectShape(expected, `new-session-${split}`);
    });
  }

  test("stays in the row it was asked for when an earlier row is empty too", async () => {
    await launch({ folder: view("cols:2-2-1", "a", null, "b", null, "c") });
    await openFolder();
    await startSessionInEmptySlot(3);
    await expectShape(`a/_|b/${NEW_SESSION}|c`, "new-session-second-hole");
  });

  test("stays in that row on 작업공간", async () => {
    await launch({ workspace: view("cols:2-1-1", "a", null, "b", "c") });
    await openWorkspace(3);
    await startSessionInEmptySlot(1);
    await expectShape(`a/${NEW_SESSION}|b|c`, "new-session-workspace");
  });
});

test("a pane dragged in from 숨김 fills the empty row and moves nobody", async () => {
  await launch({ workspace: view("cols:2-1-1", "a", null, "b", "c"), hidden: view("cols:1", "h") });
  await openWorkspace(3);
  await page.getByRole("button", { name: "숨김 펼치기", exact: true }).click();
  await dragPane("h", 1, "sidebar");
  await expectShape("a/h|b|c", "drag-from-hidden");
  await expect(page.getByRole("button", { name: "숨김 열기 (패인 0개)", exact: true })).toBeVisible();
});

test("hiding a pane on 작업공간 leaves its slot empty and moves nobody", async () => {
  await launch({ workspace: view("cols:2-1-1", "a", "b", "c", "d") });
  await openWorkspace(4);
  await pane("a").getByRole("button", { name: "작업공간에서 숨기기", exact: true }).click();
  await expectShape("_/b|c|d", "hide-on-workspace");
  await expect(page.getByRole("button", { name: "숨김 열기 (패인 1개)", exact: true })).toBeVisible();
});

test("a pane dragged into an empty row leaves its old slot empty", async () => {
  await launch({ folder: view("cols:2-1-1", "a", null, "b", "c") });
  await openFolder();
  await markTerminal("c");
  await dragPane("c", 1);
  await expectShape("a/c|b|_", "drag-into-empty");
  await expectTerminalKept("c");
});

test("a pane dropped on another trades places with it", async () => {
  await launch({ folder: view("cols:1-2-1", "a", "b", "c", "d") });
  await openFolder();
  await markTerminal("b");
  await markTerminal("d");
  await dragPane("d", 1);
  await expectShape("a|d/c|b", "drag-onto-pane");
  await expectTerminalKept("b");
  await expectTerminalKept("d");
});

test.describe("closing a pane in a layout with a split", () => {
  for (const { name, seed, expected } of [
    { name: "top of a full column", seed: view("cols:2-1-1", "a", "b", "c", "d"), expected: "_/b|c|d" },
    { name: "top above an empty row", seed: view("cols:2-1-1", "a", null, "b", "c"), expected: "_/_|b|c" },
    { name: "column before a split one", seed: view("cols:1-2-1", "a", "b", "c", "d"), expected: "_|b/c|d" },
  ]) {
    test(`leaves an empty slot and moves nobody: ${name}`, async () => {
      await launch({ folder: seed });
      await openFolder();
      await closeButton("a").click();
      await expectShape(expected, `close-${name.replace(/ /g, "-")}`);
    });
  }
});

test("closing a pane in a layout with no split still closes the gap", async () => {
  await launch({ folder: view("cols:1-1-1", "a", "b", "c") });
  await openFolder();
  await closeButton("a").click();
  await expectShape("b|c|_", "close-unsplit");
});

test.describe("removing a session", () => {
  const removeSession = async (name: string) => {
    await pane(name).locator(".pane-header").click({ button: "right" });
    await page.getByRole("menuitem", { name: "제거", exact: true }).click();
  };

  test("leaves its slot empty in a layout with a split", async () => {
    await launch({ folder: view("cols:2-1-1", "a", "b", "c", "d") });
    await openFolder();
    await removeSession("a");
    await expectShape("_/b|c|d", "remove-in-split");
  });

  test("closes the gap in a layout with no split", async () => {
    await launch({ folder: view("cols:1-1-1", "a", "b", "c") });
    await openFolder();
    await removeSession("a");
    await expectShape("b|c|_", "remove-unsplit");
  });
});

test("merging a full column gives its lower pane a column of its own", async () => {
  await launch({ workspace: view("cols:1-2-1", "a", "b", "c", "d") });
  await openWorkspace(4);
  await markTerminal("b");
  await markTerminal("c");
  await mergeButton("c").click();
  await expectShape("a|b|c|d", "merge-full-column");
  await expectTerminalKept("b");
  await expectTerminalKept("c");
});

test("merging on 숨김 keeps both panes on 숨김", async () => {
  await launch({ workspace: view("cols:1", "w"), hidden: view("cols:2", "h1", "h2") });
  await page.getByRole("button", { name: "숨김 열기 (패인 2개)", exact: true }).click();
  await mergeButton("h1").click();
  await expectShape("h1|h2", "merge-on-hidden");
  await expect(page.getByRole("button", { name: "숨김 열기 (패인 2개)", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "세션 작업공간 열기 (패인 1개)", exact: true })).toBeVisible();
});

test("merging a column with an empty top row keeps its only pane", async () => {
  await launch({ folder: view("cols:2-1", null, "a", "c") });
  await openFolder();
  await mergeButton("a").click();
  await expectShape("a|c", "merge-empty-top");
});

test("choosing a tile with no split drops the holes the split left behind", async () => {
  await launch({ folder: view("cols:2-1-1", "a", null, "b", "c") });
  await openFolder();
  await page.locator(".layout-bar").getByRole("radio", { name: "3열", exact: true }).click();
  await expectShape("a|b|c", "tile-after-split");
});
