import type { AgentView } from "@shared/agent-types";
import type { TerminalStatus, ToolCommand } from "@shared/terminal-types";
import { KEYMAP_ACTIONS, effectiveAccelerator, findKeymapAction, qualifiedLabel } from "./keymap";
import type { QuickOpenItem } from "./quick-open";
import { TOOL_AGENT_ID, findAgent, newSessionLabel } from "./session-labels";

/**
 * When a command can run and what it is called right now. The menu bar, the command palette and the
 * keyboard dispatcher all ask here, so "why is this greyed out?" has one answer everywhere — a key
 * whose command is off passes through to the terminal instead of being swallowed for nothing.
 */
export interface CommandContext {
  agents: readonly AgentView[];
  /** The folder in scope, or null on the home screen. `missing` means its root is gone from disk. */
  project: { missing: boolean } | null;
  /** The registry fell back to a read-only copy, so nothing may be written to it. */
  readOnly: boolean;
  /** A session action is already in flight; a second one would race it. */
  pendingAction: boolean;
  /**
   * The session behind the focused pane — what 재개·새로고침·중지·제거 act on, the same session the
   * pane's own header buttons drive. `missingRoot`: its folder is gone, so it cannot be resumed.
   */
  session: { status: TerminalStatus; refreshing: boolean; missingRoot: boolean } | null;
  /**
   * Where 새 세션 would start — the folder on screen, or the focused pane's folder on a shelf — or
   * null when there is nowhere. `blockedReason` says why that place cannot start anything right now.
   */
  launch: { label: string; blockedReason: string | null } | null;
  /**
   * Whether a terminal currently owns the keyboard. The 터미널 commands drive xterm's own selection
   * and clipboard, so with a file tab or the home screen in front there is nothing for them to act on.
   */
  terminalFocused: boolean;
  /** An open file tab whose contents can be written back. */
  canSaveFile: boolean;
  sidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  /** The grid on screen, or null when there is none: no pane to zoom and no page to turn. */
  grid: { page: number; pages: number } | null;
  /** When the desktop notifications come back on, or null while they are on. */
  notificationsSnoozedUntil: string | null;
  now: number;
}

const TOOL_COMMANDS: Record<string, ToolCommand> = {
  "tools.claude-update": "claude-update",
  "tools.codex-update": "codex-update",
};

/** The id prefix a 새 세션 command carries; the rest of the id is the agent to launch. */
export const NEW_SESSION_PREFIX = "session.new:";

/** Whether 알림 끄기/켜기 would turn the notifications back on — the dispatcher's half of the toggle. */
export function notificationsSnoozed(context: Pick<CommandContext, "notificationsSnoozedUntil" | "now">): boolean {
  const until = context.notificationsSnoozedUntil;
  return until !== null && Date.parse(until) > context.now;
}

function clock(iso: string): string {
  const time = new Date(iso);
  return `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
}

export function canStartSession(agent: AgentView, context: CommandContext): boolean {
  return context.launch !== null && context.launch.blockedReason === null && !context.pendingAction && agent.available;
}

export function commandEnabled(id: string, context: CommandContext): boolean {
  const { session } = context;
  const finished = session?.status === "exited" || session?.status === "error";
  if (id.startsWith(NEW_SESSION_PREFIX)) {
    const agent = context.agents.find((candidate) => candidate.id === id.slice(NEW_SESSION_PREFIX.length));
    return agent ? canStartSession(agent, context) : false;
  }
  const tool = TOOL_COMMANDS[id];
  if (tool) return Boolean(findAgent(context.agents, TOOL_AGENT_ID[tool])?.available) && !context.pendingAction;
  switch (id) {
    case "file.add-folder":
    case "file.add-work-project":
      return !context.readOnly;
    case "file.save":
      return context.canSaveFile;
    case "file.relink":
      return context.project !== null && !context.readOnly;
    case "session.resume":
      return session !== null && finished && !context.pendingAction && !session.missingRoot;
    case "session.refresh":
      return session !== null && !session.refreshing;
    case "session.stop":
      return session !== null && !finished && !context.pendingAction;
    case "session.remove":
      return session !== null && !context.pendingAction;
    case "edit.copy":
    case "edit.paste":
    case "edit.select-all":
    case "edit.find":
    case "edit.clear":
      return context.terminalFocused;
    case "view.zoom-pane":
      return context.grid !== null;
    // 넘길 페이지가 없으면 키를 삼키지 않는다 — 터미널 안 프로그램이 Ctrl+PageUp/Down을 받는다.
    case "workspace.page-prev":
      return context.grid !== null && context.grid.page > 0;
    case "workspace.page-next":
      return context.grid !== null && context.grid.page < context.grid.pages - 1;
    default:
      return true;
  }
}

/** The command's name as of now: a toggle says what pressing it will do. */
export function commandLabel(id: string, context: CommandContext): string {
  switch (id) {
    case "view.toggle-sidebar":
      return context.sidebarCollapsed ? "왼쪽 사이드바 펼치기" : "왼쪽 사이드바 접기";
    case "view.toggle-right-sidebar":
      return context.rightSidebarCollapsed ? "오른쪽 사이드바 펼치기" : "오른쪽 사이드바 접기";
    case "notifications.snooze":
      return notificationsSnoozed(context)
        ? `알림 다시 켜기 (${clock(context.notificationsSnoozedUntil!)}까지 꺼짐)`
        : "알림 1시간 끄기";
    default:
      return findKeymapAction(id)?.label ?? id;
  }
}

/**
 * The palette's 명령 rows: every registry command that can run right now, named with its category
 * and carrying its shortcut, then one 새 세션 per installed agent aimed where the menu's would go.
 * A command that is off is left out rather than shown dead — the palette is for doing, not browsing.
 */
export function buildCommandItems(
  context: CommandContext,
  keybindings: Record<string, string | null>,
): QuickOpenItem[] {
  const launches: QuickOpenItem[] = context.agents
    .filter((agent) => canStartSession(agent, context))
    .map((agent) => ({
      key: `command:${NEW_SESSION_PREFIX}${agent.id}`,
      kind: "command",
      label: qualifiedLabel({ category: "세션", label: newSessionLabel(agent) }),
      detail: context.launch?.label ?? null,
      agentId: agent.id,
    }));
  const commands = KEYMAP_ACTIONS.filter((command) => command.palette && commandEnabled(command.id, context)).map(
    (command): QuickOpenItem => {
      const shortcut = effectiveAccelerator(command.id, keybindings);
      return {
        key: `command:${command.id}`,
        kind: "command",
        label: qualifiedLabel(command, commandLabel(command.id, context)),
        detail: null,
        ...(shortcut ? { shortcut } : {}),
      };
    },
  );
  return [...launches, ...commands];
}
