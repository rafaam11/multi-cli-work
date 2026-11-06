import type { AgentView } from "@shared/agent-types";
import { describe, expect, it } from "vitest";
import { buildTitleBarMenus, type TitleBarEntry, type TitleBarMenuContext } from "./title-bar-menu";

function agent(id: string, label: string, available: boolean): AgentView {
  return {
    id,
    label,
    commands: [id],
    args: [],
    newSessionArgs: [],
    resumeArgs: [],
    conversationId: "none",
    statusAdapter: "signals",
    titleSource: "none",
    shiftEnter: "enter",
    icon: id,
    accentColor: null,
    builtin: true,
    available,
  };
}

const agents = [agent("powershell", "PowerShell", true), agent("claude", "Claude Code", true), agent("codex", "Codex", false)];

const NOW = Date.parse("2026-11-06T10:00:00");

function context(overrides?: Partial<TitleBarMenuContext>): TitleBarMenuContext {
  return {
    agents,
    appVersion: "1.12.0",
    project: { missing: false },
    readOnly: false,
    pendingAction: false,
    session: { status: "working", refreshing: false, missingRoot: false },
    launch: { label: "Atlas", blockedReason: null },
    terminalFocused: true,
    canSaveFile: false,
    sidebarCollapsed: false,
    rightSidebarCollapsed: false,
    grid: { page: 0, pages: 1 },
    notificationsSnoozedUntil: null,
    now: NOW,
    ...overrides,
  };
}

function flatten(entries: TitleBarEntry[]): TitleBarEntry[] {
  return entries.flatMap((entry) => (entry.kind === "submenu" ? [entry, ...flatten(entry.items)] : [entry]));
}

function find(overrides: Partial<TitleBarMenuContext> | undefined, id: string, keybindings?: Record<string, string | null>) {
  const entry = buildTitleBarMenus(context(overrides), keybindings)
    .flatMap((menu) => flatten(menu.entries))
    .find((candidate) => candidate.kind !== "separator" && candidate.id === id);
  if (!entry || entry.kind === "separator") throw new Error(`No menu entry with id ${id}`);
  return entry;
}

function idsOf(menuId: string): (string | null)[] {
  const menu = buildTitleBarMenus(context()).find((candidate) => candidate.id === menuId)!;
  return menu.entries.map((entry) => (entry.kind === "separator" ? null : entry.id));
}

describe("buildTitleBarMenus", () => {
  it("lays out four menus and the settings button — 편집 and 도구 are gone", () => {
    expect(buildTitleBarMenus(context()).map((menu) => [menu.id, menu.label])).toEqual([
      ["file", "파일"],
      ["view", "보기"],
      ["session", "세션"],
      ["help", "도움말"],
      ["settings", "설정"],
    ]);
  });

  it("places each menu's commands in the designed order", () => {
    expect(idsOf("file")).toEqual(["file.add-folder", "file.add-work-project", null, "file.save", "file.relink", null, "file.quit"]);
    expect(idsOf("view")).toEqual([
      "view.commands",
      "view.quick-open",
      "view.home",
      null,
      "view.toggle-sidebar",
      "view.toggle-right-sidebar",
      "view.records",
      null,
      "view.zoom-pane",
      null,
      "view.zoom",
      "view.full-screen",
      null,
      "file.refresh",
      "workspace.reload",
    ]);
    expect(idsOf("session")).toEqual([
      "session.new",
      null,
      "session.next",
      "session.prev",
      "session.next-waiting",
      null,
      "session.resume",
      "session.refresh",
      "session.stop",
      "session.remove",
      null,
      "session.prompts",
      "session.deliveries",
      "notifications.snooze",
      null,
      "session.agents",
    ]);
    expect(idsOf("help")).toEqual([
      "help.check-updates",
      "help.release-notes",
      "help.repository",
      null,
      "help.keybindings",
      null,
      "help.troubleshoot",
      null,
      "help.version",
    ]);
  });

  it("files the zoom levels, the CLI updates and the developer tools under submenus", () => {
    const zoom = find(undefined, "view.zoom");
    const agentsMenu = find(undefined, "session.agents");
    const troubleshoot = find(undefined, "help.troubleshoot");
    const ids = (entry: TitleBarEntry) =>
      entry.kind === "submenu" ? entry.items.map((item) => (item.kind === "separator" ? null : item.id)) : [];
    expect(ids(zoom)).toEqual(["view.zoom-in", "view.zoom-out", "view.zoom-reset"]);
    expect(ids(agentsMenu)).toEqual(["tools.claude-update", "tools.codex-update", null, "tools.edit-agents"]);
    expect(ids(troubleshoot)).toEqual(["view.reload", "view.dev-tools"]);
  });

  it("names menu items with the registry's one label", () => {
    expect(find(undefined, "file.add-folder").label).toBe("폴더 열기");
    expect(find(undefined, "file.add-work-project").label).toBe("업무 프로젝트 만들기");
    expect(find(undefined, "session.stop").label).toBe("중지");
    expect(find(undefined, "view.commands").label).toBe("명령 팔레트");
  });

  it("builds the 새 세션 submenu from the agent registry, disabling the ones not on PATH", () => {
    const submenu = find(undefined, "session.new");
    expect(submenu.kind).toBe("submenu");
    if (submenu.kind !== "submenu") return;
    expect(submenu.items.map((entry) => (entry.kind === "item" ? [entry.id, entry.label, entry.disabled] : null))).toEqual([
      ["session.new:powershell", "PowerShell", undefined],
      ["session.new:claude", "Claude Code", undefined],
      ["session.new:codex", "Codex", true],
    ]);
  });

  it("closes the 새 세션 submenu when there is nowhere to start, and greys it while that place is blocked", () => {
    expect(find({ launch: null }, "session.new").disabled).toBe(true);
    const blocked = find({ launch: { label: "Atlas", blockedReason: "폴더를 찾을 수 없습니다" } }, "session.new");
    expect(blocked.disabled).toBeUndefined();
    if (blocked.kind !== "submenu") return;
    expect(blocked.items.every((item) => item.kind === "item" && item.disabled)).toBe(true);
  });

  it("offers 재개 only for a finished session, and not while its own folder is missing", () => {
    expect(find(undefined, "session.resume").disabled).toBe(true);
    expect(find({ session: { status: "exited", refreshing: false, missingRoot: false } }, "session.resume").disabled).toBeUndefined();
    expect(find({ session: { status: "exited", refreshing: false, missingRoot: true } }, "session.resume").disabled).toBe(true);
  });

  it("keeps every session command off without a focused session", () => {
    for (const id of ["session.resume", "session.refresh", "session.stop", "session.remove"]) {
      expect(find({ session: null }, id).disabled).toBe(true);
    }
  });

  it("keeps 중지 and 제거 out of reach while another session action is in flight", () => {
    expect(find({ pendingAction: true }, "session.stop").disabled).toBe(true);
    expect(find({ pendingAction: true }, "session.remove").disabled).toBe(true);
  });

  it("names the toggles after what they will do", () => {
    expect(find({ sidebarCollapsed: true }, "view.toggle-sidebar").label).toBe("왼쪽 사이드바 펼치기");
    expect(find({ rightSidebarCollapsed: false }, "view.toggle-right-sidebar").label).toBe("오른쪽 사이드바 접기");
    expect(find(undefined, "notifications.snooze").label).toBe("알림 1시간 끄기");
    const until = new Date(NOW + 30 * 60_000).toISOString();
    expect(find({ notificationsSnoozedUntil: until }, "notifications.snooze").label).toBe("알림 다시 켜기 (10:30까지 꺼짐)");
    // A snooze that already ran out is not one any more.
    const past = new Date(NOW - 60_000).toISOString();
    expect(find({ notificationsSnoozedUntil: past }, "notifications.snooze").label).toBe("알림 1시간 끄기");
  });

  it("blocks registry writes when the workspace fell back to a read-only copy", () => {
    expect(find({ readOnly: true }, "file.add-folder").disabled).toBe(true);
    expect(find({ readOnly: true }, "file.add-work-project").disabled).toBe(true);
    expect(find({ readOnly: true }, "file.relink").disabled).toBe(true);
  });

  it("enables 파일 저장 only for a savable tab, and 패인 확대 only with a grid", () => {
    expect(find({ canSaveFile: false }, "file.save").disabled).toBe(true);
    expect(find({ canSaveFile: true }, "file.save").disabled).toBeUndefined();
    expect(find({ grid: null }, "view.zoom-pane").disabled).toBe(true);
    expect(find(undefined, "view.zoom-pane").disabled).toBeUndefined();
  });

  it("disables a CLI update when that CLI is not installed", () => {
    expect(find(undefined, "tools.claude-update").disabled).toBeUndefined();
    expect(find(undefined, "tools.codex-update").disabled).toBe(true);
  });

  it("reports the running version in 도움말 instead of opening a dialog", () => {
    const version = find(undefined, "help.version");
    expect(version.label).toBe("버전 v1.12.0");
    expect(version.disabled).toBe(true);
  });

  it("도움말 오른쪽에 드롭다운 없는 설정 버튼이 선다", () => {
    const menus = buildTitleBarMenus(context());
    const last = menus[menus.length - 1]!;
    expect(last).toMatchObject({ id: "settings", label: "설정", action: "settings.open" });
    expect(last.entries).toEqual([]);
    expect(menus[menus.length - 2]!.id).toBe("help");
  });

  it("단축키 표기가 키맵 기본값에서 나온다", () => {
    const shortcut = (id: string) => {
      const entry = find(undefined, id);
      return entry.kind === "item" ? entry.shortcut : undefined;
    };
    expect(shortcut("view.quick-open")).toBe("Ctrl+P");
    expect(shortcut("view.commands")).toBe("Ctrl+Shift+P");
    expect(shortcut("file.save")).toBe("Ctrl+S");
    expect(shortcut("view.zoom-in")).toBe("Ctrl+=");
    expect(shortcut("file.refresh")).toBe("F5");
    expect(shortcut("session.next-waiting")).toBe("Ctrl+Shift+U");
    expect(shortcut("view.zoom-pane")).toBe("Ctrl+Shift+Enter");
    expect(shortcut("session.refresh")).toBeUndefined();
    expect(shortcut("view.reload")).toBeUndefined();
  });

  it("리매핑과 해제가 메뉴 표기에 반영된다", () => {
    const entry = (id: string) => find(undefined, id, { "view.quick-open": "Ctrl+K", "session.stop": "Ctrl+Alt+S" });
    expect(entry("view.quick-open")).toMatchObject({ shortcut: "Ctrl+K" });
    // A command that had no key can be given one, and the menu says so.
    expect(entry("session.stop")).toMatchObject({ shortcut: "Ctrl+Alt+S" });
    expect(find(undefined, "view.quick-open", { "view.quick-open": null })).not.toHaveProperty("shortcut");
  });
});
