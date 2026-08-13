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

function context(overrides?: Partial<TitleBarMenuContext>): TitleBarMenuContext {
  return {
    agents,
    appVersion: "1.12.0",
    project: { missing: false },
    readOnly: false,
    pendingAction: false,
    session: { status: "working", tool: false, refreshing: false },
    terminalFocused: true,
    canSaveFile: false,
    sidebarCollapsed: false,
    rightSidebarCollapsed: false,
    ...overrides,
  };
}

const settingsButtonContext: TitleBarMenuContext = {
  agents: [],
  appVersion: "1.0.0",
  project: null,
  readOnly: false,
  pendingAction: false,
  session: null,
  terminalFocused: false,
  canSaveFile: false,
  sidebarCollapsed: false,
  rightSidebarCollapsed: false,
};

function flatten(entries: TitleBarEntry[]): TitleBarEntry[] {
  return entries.flatMap((entry) => (entry.kind === "submenu" ? [entry, ...entry.items] : [entry]));
}

function find(overrides: Partial<TitleBarMenuContext> | undefined, id: string) {
  const entry = buildTitleBarMenus(context(overrides))
    .flatMap((menu) => flatten(menu.entries))
    .find((candidate) => candidate.kind !== "separator" && candidate.id === id);
  if (!entry || entry.kind === "separator") throw new Error(`No menu entry with id ${id}`);
  return entry;
}

describe("buildTitleBarMenus", () => {
  it("lays out the six top-level menus in VS Code's order", () => {
    expect(buildTitleBarMenus(context()).map((menu) => [menu.id, menu.label])).toEqual([
      ["file", "파일"],
      ["edit", "편집"],
      ["view", "보기"],
      ["session", "세션"],
      ["tools", "도구"],
      ["help", "도움말"],
      ["settings", "설정"],
    ]);
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

  it("closes the 새 세션 submenu when no folder is in scope", () => {
    expect(find({ project: null }, "session.new").disabled).toBe(true);
  });

  it("disables every 편집 command unless a terminal owns the keyboard", () => {
    for (const id of ["edit.copy", "edit.paste", "edit.select-all", "edit.clear"]) {
      expect(find({ terminalFocused: false }, id).disabled).toBe(true);
      expect(find({ terminalFocused: true }, id).disabled).toBeUndefined();
    }
  });

  it("offers 재개 only for a finished session, and not while its folder is missing", () => {
    expect(find({ session: { status: "working", tool: false, refreshing: false } }, "session.resume").disabled).toBe(true);
    expect(find({ session: { status: "exited", tool: false, refreshing: false } }, "session.resume").disabled).toBeUndefined();
    expect(
      find(
        { project: { missing: true }, session: { status: "exited", tool: false, refreshing: false } },
        "session.resume",
      ).disabled,
    ).toBe(true);
    // A tool session belongs to no folder, so a missing root is none of its business.
    expect(
      find(
        { project: { missing: true }, session: { status: "exited", tool: true, refreshing: false } },
        "session.resume",
      ).disabled,
    ).toBeUndefined();
  });

  it("keeps 중지 and 제거 out of reach while another session action is in flight", () => {
    expect(find({ pendingAction: true }, "session.stop").disabled).toBe(true);
    expect(find({ pendingAction: true }, "session.remove").disabled).toBe(true);
  });

  it("leaves the pane layout to the grid instead of a 세션 menu command", () => {
    const sessionMenu = buildTitleBarMenus(context()).find((menu) => menu.id === "session")!;
    const ids = flatten(sessionMenu.entries).map((entry) => (entry.kind === "separator" ? null : entry.id));
    expect(ids).not.toContain("session.split");
  });

  it("names the sidebar commands after what they will do", () => {
    expect(find({ sidebarCollapsed: true }, "view.toggle-sidebar").label).toBe("왼쪽 사이드바 펼치기");
    expect(find({ rightSidebarCollapsed: false }, "view.toggle-right-sidebar").label).toBe("오른쪽 사이드바 접기");
  });

  it("blocks registry writes when the workspace fell back to a read-only copy", () => {
    expect(find({ readOnly: true }, "file.add-folder").disabled).toBe(true);
    expect(find({ readOnly: true }, "file.add-work-project").disabled).toBe(true);
    expect(find({ readOnly: true }, "file.relink").disabled).toBe(true);
  });

  it("enables 파일 저장 only for a savable tab", () => {
    expect(find({ canSaveFile: false }, "file.save").disabled).toBe(true);
    expect(find({ canSaveFile: true }, "file.save").disabled).toBeUndefined();
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
    const menus = buildTitleBarMenus(settingsButtonContext);
    const last = menus[menus.length - 1]!;
    expect(last).toMatchObject({ id: "settings", label: "설정", action: "settings.open" });
    expect(last.entries).toEqual([]);
    expect(menus[menus.length - 2]!.id).toBe("help");
  });
});
