import type { AgentView } from "@shared/agent-types";
import type { TerminalStatus, ToolCommand } from "@shared/terminal-types";
import { TOOL_AGENT_ID, findAgent, toolDetails } from "./session-labels";

/**
 * The title bar's menus as plain data. Keeping the enablement rules out of the component is what
 * makes them checkable: every "why is this greyed out?" answer lives in `buildTitleBarMenus` and is
 * asserted directly, instead of being reached through a rendered dropdown.
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

const TOOL_COMMANDS: readonly ToolCommand[] = ["claude-update", "codex-update"];

/** The id prefix a 새 세션 item carries; the rest of the id is the agent to launch. */
export const NEW_SESSION_PREFIX = "session.new:";

export interface TitleBarMenuContext {
  agents: readonly AgentView[];
  /** Shown as the last 도움말 entry instead of an about dialog the app does not have. */
  appVersion: string;
  /** The folder in scope, or null on the home screen. `missing` means its root is gone from disk. */
  project: { missing: boolean } | null;
  /** The registry fell back to a read-only copy, so nothing may be written to it. */
  readOnly: boolean;
  /** A session action is already in flight; a second one would race it. */
  pendingAction: boolean;
  /** The session the 세션 menu acts on. */
  session: { status: TerminalStatus; tool: boolean; refreshing: boolean } | null;
  /**
   * Whether a terminal currently owns the keyboard. The 편집 menu drives xterm's own selection and
   * clipboard, so with a file tab or the home screen in front there is nothing for it to act on.
   */
  terminalFocused: boolean;
  /** An open file tab whose contents can be written back. */
  canSaveFile: boolean;
  sidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
}

const separator: TitleBarEntry = { kind: "separator" };

function item(id: string, label: string, options?: { shortcut?: string; disabled?: boolean }): TitleBarEntry {
  return {
    kind: "item",
    id,
    label,
    ...(options?.shortcut ? { shortcut: options.shortcut } : {}),
    ...(options?.disabled ? { disabled: true } : {}),
  };
}

export function buildTitleBarMenus(context: TitleBarMenuContext): TitleBarMenu[] {
  const { project, session } = context;
  // Same rules the workspace header uses for its own buttons, so the two never disagree.
  const finished = session?.status === "exited" || session?.status === "error";
  const canLaunch = project !== null && !project.missing && !context.pendingAction;
  const blockedByMissingRoot = Boolean(project?.missing) && !session?.tool;

  return [
    {
      id: "file",
      label: "파일",
      entries: [
        item("file.add-folder", "폴더 추가", { disabled: context.readOnly }),
        item("file.add-work-project", "업무 프로젝트 추가", { disabled: context.readOnly }),
        separator,
        item("file.save", "파일 저장", { shortcut: "Ctrl+S", disabled: !context.canSaveFile }),
        item("file.relink", "폴더 다시 연결", { disabled: project === null || context.readOnly }),
        separator,
        item("file.quit", "종료"),
      ],
    },
    {
      id: "edit",
      label: "편집",
      entries: [
        item("edit.copy", "복사", { shortcut: "Ctrl+Shift+C", disabled: !context.terminalFocused }),
        item("edit.paste", "붙여넣기", { shortcut: "Ctrl+V", disabled: !context.terminalFocused }),
        item("edit.select-all", "모두 선택", { shortcut: "Ctrl+A", disabled: !context.terminalFocused }),
        separator,
        item("edit.clear", "터미널 지우기", { disabled: !context.terminalFocused }),
      ],
    },
    {
      id: "view",
      label: "보기",
      entries: [
        item("view.toggle-sidebar", context.sidebarCollapsed ? "왼쪽 사이드바 펼치기" : "왼쪽 사이드바 접기"),
        item(
          "view.toggle-right-sidebar",
          context.rightSidebarCollapsed ? "오른쪽 사이드바 펼치기" : "오른쪽 사이드바 접기",
        ),
        separator,
        item("view.quick-open", "빠른 열기", { shortcut: "Ctrl+P" }),
        separator,
        item("view.zoom-in", "확대", { shortcut: "Ctrl+=" }),
        item("view.zoom-out", "축소", { shortcut: "Ctrl+-" }),
        item("view.zoom-reset", "원래 크기", { shortcut: "Ctrl+0" }),
        item("view.full-screen", "전체 화면", { shortcut: "F11" }),
        separator,
        item("view.reload", "다시 로드"),
        item("view.dev-tools", "개발자 도구", { shortcut: "F12" }),
      ],
    },
    {
      id: "session",
      label: "세션",
      entries: [
        {
          kind: "submenu",
          id: "session.new",
          label: "새 세션",
          disabled: project === null,
          items: context.agents.map((agent) =>
            item(`${NEW_SESSION_PREFIX}${agent.id}`, agent.label, { disabled: !canLaunch || !agent.available }),
          ),
        },
        separator,
        item("session.resume", "재개", {
          disabled: !session || !finished || context.pendingAction || blockedByMissingRoot,
        }),
        item("session.refresh", "새로고침", { disabled: !session || session.refreshing }),
        item("session.stop", "중지", { disabled: !session || finished || context.pendingAction }),
        item("session.remove", "제거", { disabled: !session || context.pendingAction }),
      ],
    },
    {
      id: "tools",
      label: "도구",
      entries: [
        ...TOOL_COMMANDS.map((tool) =>
          item(`tools.${tool}`, toolDetails[tool].menuLabel, {
            disabled: !findAgent(context.agents, TOOL_AGENT_ID[tool])?.available || context.pendingAction,
          }),
        ),
        separator,
        item("tools.edit-agents", "에이전트 추가"),
      ],
    },
    {
      id: "help",
      label: "도움말",
      entries: [
        item("help.check-updates", "업데이트 확인"),
        item("help.release-notes", "릴리스 노트"),
        item("help.repository", "GitHub 저장소"),
        separator,
        item("help.version", `버전 v${context.appVersion}`, { disabled: true }),
      ],
    },
    // 스펙: "도움말" 오른쪽. 메뉴가 아니라 버튼 — 누르면 설정 창이 바로 열린다.
    { id: "settings", label: "설정", entries: [], action: "settings.open" },
  ];
}
