import { NEW_SESSION_PREFIX, canStartSession, commandEnabled, commandLabel, type CommandContext } from "./commands";
import { effectiveAccelerator } from "./keymap";

export { NEW_SESSION_PREFIX } from "./commands";

/**
 * The title bar's menus as plain data. The menus only say where each command sits; what it is called,
 * which key runs it and whether it can run right now all come from the command registry
 * (`keymap.ts`) and `commands.ts`, which the command palette reads too — so the two never disagree.
 */
export type TitleBarEntry =
  | { kind: "separator" }
  | { kind: "item"; id: string; label: string; shortcut?: string; disabled?: boolean }
  | { kind: "submenu"; id: string; label: string; disabled?: boolean; items: TitleBarEntry[] };

export interface TitleBarMenu {
  id: string;
  label: string;
  entries: TitleBarEntry[];
  /** 있으면 드롭다운 대신 버튼이다 — 클릭이 이 액션 id를 바로 쏜다. */
  action?: string;
}

export interface TitleBarMenuContext extends CommandContext {
  /** Shown as the last 도움말 entry instead of an about dialog the app does not have. */
  appVersion: string;
}

/** A place in a menu: a command id, a separator, or a flyout of further places. */
type Slot = string | "-" | { submenu: string; label: string; items: Slot[] } | "new-session" | "version";

const MENU_LAYOUT: { id: string; label: string; slots: Slot[] }[] = [
  {
    id: "file",
    label: "파일",
    slots: ["file.add-folder", "file.add-work-project", "-", "file.save", "file.relink", "-", "file.quit"],
  },
  {
    id: "view",
    label: "보기",
    slots: [
      "view.commands",
      "view.quick-open",
      "view.home",
      "-",
      "view.toggle-sidebar",
      "view.toggle-right-sidebar",
      "view.records",
      "-",
      "view.zoom-pane",
      "-",
      { submenu: "view.zoom", label: "화면 배율", items: ["view.zoom-in", "view.zoom-out", "view.zoom-reset"] },
      "view.full-screen",
      "-",
      "file.refresh",
      "workspace.reload",
    ],
  },
  {
    id: "session",
    label: "세션",
    slots: [
      "new-session",
      "-",
      "session.next",
      "session.prev",
      "session.next-waiting",
      "-",
      "session.resume",
      "session.refresh",
      "session.stop",
      "session.remove",
      "-",
      "session.prompts",
      "session.deliveries",
      "notifications.snooze",
      "-",
      {
        submenu: "session.agents",
        label: "에이전트",
        items: ["tools.claude-update", "tools.codex-update", "-", "tools.edit-agents"],
      },
    ],
  },
  {
    id: "help",
    label: "도움말",
    slots: [
      "help.check-updates",
      "help.release-notes",
      "help.repository",
      "-",
      "help.keybindings",
      "-",
      { submenu: "help.troubleshoot", label: "문제 해결", items: ["view.reload", "view.dev-tools"] },
      "-",
      "version",
    ],
  },
];

const separator: TitleBarEntry = { kind: "separator" };

export function buildTitleBarMenus(
  context: TitleBarMenuContext,
  keybindings: Record<string, string | null> = {},
): TitleBarMenu[] {
  const command = (id: string): TitleBarEntry => {
    const shortcut = effectiveAccelerator(id, keybindings);
    return {
      kind: "item",
      id,
      label: commandLabel(id, context),
      ...(shortcut ? { shortcut } : {}),
      ...(commandEnabled(id, context) ? {} : { disabled: true }),
    };
  };

  const place = (slot: Slot): TitleBarEntry => {
    if (slot === "-") return separator;
    if (slot === "version") {
      return { kind: "item", id: "help.version", label: `버전 v${context.appVersion}`, disabled: true };
    }
    if (slot === "new-session") {
      return {
        kind: "submenu",
        id: "session.new",
        label: "새 세션",
        ...(context.launch === null ? { disabled: true } : {}),
        items: context.agents.map((agent) => ({
          kind: "item",
          id: `${NEW_SESSION_PREFIX}${agent.id}`,
          label: agent.label,
          ...(canStartSession(agent, context) ? {} : { disabled: true }),
        })),
      };
    }
    if (typeof slot === "object") {
      return { kind: "submenu", id: slot.submenu, label: slot.label, items: slot.items.map(place) };
    }
    return command(slot);
  };

  return [
    ...MENU_LAYOUT.map((menu) => ({ id: menu.id, label: menu.label, entries: menu.slots.map(place) })),
    // 스펙: "도움말" 오른쪽. 메뉴가 아니라 버튼 — 누르면 설정 창이 바로 열린다.
    { id: "settings", label: "설정", entries: [], action: "settings.open" },
  ];
}
