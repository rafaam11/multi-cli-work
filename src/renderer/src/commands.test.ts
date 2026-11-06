import type { AgentView } from "@shared/agent-types";
import { describe, expect, it } from "vitest";
import { buildCommandItems, commandEnabled, type CommandContext } from "./commands";
import { KEYMAP_ACTIONS } from "./keymap";

const claude = { id: "claude", label: "Claude Code", available: true } as AgentView;
const codex = { id: "codex", label: "Codex", available: false } as AgentView;
const claudeTool = { id: "claude", label: "Claude Code", available: true } as AgentView;

function context(overrides?: Partial<CommandContext>): CommandContext {
  return {
    agents: [claude, codex],
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
    now: Date.parse("2026-11-06T10:00:00"),
    ...overrides,
  };
}

const keyOf = (id: string) => `command:${id}`;

describe("buildCommandItems", () => {
  it("lists every palette command that can run, named with its category", () => {
    const items = buildCommandItems(context(), {});
    expect(items.find((item) => item.key === keyOf("session.stop"))).toMatchObject({ kind: "command", label: "세션: 중지" });
    expect(items.find((item) => item.key === keyOf("view.zoom-in"))).toMatchObject({ label: "보기: 확대", shortcut: "Ctrl+=" });
    expect(items.find((item) => item.key === keyOf("workspace.focus-slot-3"))).toMatchObject({ label: "이동: 슬롯 3 포커스" });
    expect(items.find((item) => item.key === keyOf("help.check-updates"))).toMatchObject({ label: "도움말: 업데이트 확인" });
  });

  it("leaves out a command that is off right now, rather than listing it dead", () => {
    const keys = buildCommandItems(context({ session: null, canSaveFile: false }), {}).map((item) => item.key);
    expect(keys).not.toContain(keyOf("session.stop"));
    expect(keys).not.toContain(keyOf("file.save"));
    // The codex update needs codex on PATH.
    expect(keys).not.toContain(keyOf("tools.codex-update"));
    expect(keys).toContain(keyOf("tools.claude-update"));
  });

  it("never lists the clipboard trio", () => {
    const keys = buildCommandItems(context(), {}).map((item) => item.key);
    for (const id of ["edit.copy", "edit.paste", "edit.select-all"]) expect(keys).not.toContain(keyOf(id));
    expect(keys).toContain(keyOf("edit.find"));
  });

  it("shows the key a remap gave, and none once it is cleared", () => {
    const items = buildCommandItems(context(), { "session.stop": "Ctrl+Alt+S", "view.quick-open": null });
    expect(items.find((item) => item.key === keyOf("session.stop"))?.shortcut).toBe("Ctrl+Alt+S");
    expect(items.find((item) => item.key === keyOf("view.quick-open"))).not.toHaveProperty("shortcut");
  });

  it("offers a new session per installed agent, aimed where the 세션 menu's would start", () => {
    const launches = buildCommandItems(context({ agents: [claudeTool, codex] }), {}).filter((item) =>
      item.key.startsWith("command:session.new:"),
    );
    expect(launches).toEqual([
      expect.objectContaining({ key: "command:session.new:claude", label: "세션: 새 Claude Code 세션", detail: "Atlas" }),
    ]);
    expect(buildCommandItems(context({ launch: null }), {}).some((item) => item.key.startsWith("command:session.new:"))).toBe(false);
    expect(
      buildCommandItems(context({ launch: { label: "Atlas", blockedReason: "폴더를 찾을 수 없습니다" } }), {}).some((item) =>
        item.key.startsWith("command:session.new:"),
      ),
    ).toBe(false);
  });
});

describe("commandEnabled", () => {
  it("passes Ctrl+PageUp/Down through when there is no page to turn", () => {
    expect(commandEnabled("workspace.page-prev", context({ grid: { page: 0, pages: 2 } }))).toBe(false);
    expect(commandEnabled("workspace.page-next", context({ grid: { page: 0, pages: 2 } }))).toBe(true);
    expect(commandEnabled("workspace.page-next", context({ grid: { page: 1, pages: 2 } }))).toBe(false);
    expect(commandEnabled("workspace.page-next", context({ grid: null }))).toBe(false);
  });

  it("keeps the moves that always swallowed their key swallowing it", () => {
    // These keys go to a terminal program if the app lets them through; Ctrl+Shift+U would erase a line.
    for (const id of ["session.next", "session.prev", "session.next-waiting", "workspace.focus-left", "workspace.focus-slot-1"]) {
      expect(commandEnabled(id, context({ session: null, grid: null })), id).toBe(true);
    }
  });

  it("knows every registry command", () => {
    for (const command of KEYMAP_ACTIONS) expect(typeof commandEnabled(command.id, context())).toBe("boolean");
  });
});
