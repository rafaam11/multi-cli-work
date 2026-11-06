/**
 * The command registry: every command the app can run from its menus, its command palette (Ctrl+Shift+P)
 * or a keyboard shortcut. Action ids are the cases of App.tsx's handleMenuAction switch — this
 * catalog is an index over that switch, not a new execution path. The menu bar, the palette and the
 * 단축키 settings tab all read their labels and shortcuts from here, so a remap or a rename changes
 * every surface at once.
 *
 * Ids are stored in the user's settings (`keybindings`), so an id that exists must never change.
 */

/** A command's group: the menu it lives in, or 이동 for the keyboard-only moves, or 터미널 for the right-click menu. */
export type KeymapCategory = "파일" | "보기" | "세션" | "이동" | "터미널" | "도움말";

export const KEYMAP_CATEGORY_ORDER: readonly KeymapCategory[] = ["파일", "보기", "세션", "이동", "터미널", "도움말"];

export interface KeymapAction {
  id: string;
  /** The one name the command goes by. Menus show it as is; the palette prefixes the category. */
  label: string;
  category: KeymapCategory;
  defaultAccelerator: string | null;
  /** 터미널이 키보드를 쥐고 있어도 디스패처가 가로챈다(캡처 단계). */
  terminalSafe: boolean;
  /** 모달·텍스트 입력이 포커스를 쥔 동안은 무시한다 — 슬롯 포커스·세션 순환류. */
  ignoreWhileTyping: boolean;
  /** 리매핑 불가 — 표시만 된다. edit.*는 TerminalPane의 터미널 의미론과 결합되어 있다. */
  fixed: boolean;
  /**
   * Listed in the command palette. Off for the clipboard trio: the palette takes the keyboard away
   * from the terminal they act on, so running them from there means nothing.
   */
  palette: boolean;
}

const action = (
  id: string,
  label: string,
  category: KeymapCategory,
  defaultAccelerator: string | null,
  options?: Partial<Pick<KeymapAction, "terminalSafe" | "ignoreWhileTyping" | "fixed" | "palette">>,
): KeymapAction => ({
  id,
  label,
  category,
  defaultAccelerator,
  terminalSafe: options?.terminalSafe ?? true,
  ignoreWhileTyping: options?.ignoreWhileTyping ?? false,
  fixed: options?.fixed ?? false,
  palette: options?.palette ?? true,
});

export const KEYMAP_ACTIONS: readonly KeymapAction[] = [
  // 파일
  action("file.add-folder", "폴더 열기", "파일", null),
  action("file.add-work-project", "업무 프로젝트 만들기", "파일", null),
  action("file.save", "파일 저장", "파일", "Ctrl+S"),
  action("file.relink", "폴더 다시 연결", "파일", null),
  action("settings.open", "설정 열기", "파일", "Ctrl+,"),
  action("file.quit", "종료", "파일", null),
  // 보기
  action("view.commands", "명령 팔레트", "보기", "Ctrl+Shift+P"),
  action("view.quick-open", "빠른 열기", "보기", "Ctrl+P"),
  action("view.home", "홈 대시보드", "보기", null),
  action("view.toggle-sidebar", "왼쪽 사이드바 접기/펼치기", "보기", null),
  action("view.toggle-right-sidebar", "오른쪽 사이드바 접기/펼치기", "보기", null),
  action("view.records", "폴더 기록", "보기", null),
  action("view.zoom-pane", "패인 확대/해제", "보기", "Ctrl+Shift+Enter", { ignoreWhileTyping: true }),
  action("view.zoom-in", "확대", "보기", "Ctrl+="),
  action("view.zoom-out", "축소", "보기", "Ctrl+-"),
  action("view.zoom-reset", "원래 크기", "보기", "Ctrl+0"),
  action("view.full-screen", "전체 화면", "보기", "F11"),
  action("file.refresh", "파일 목록 새로고침", "보기", "F5"),
  action("workspace.reload", "작업 영역 새로고침", "보기", null),
  // 세션
  action("session.next", "다음 세션", "세션", "Ctrl+Tab", { ignoreWhileTyping: true }),
  action("session.prev", "이전 세션", "세션", "Ctrl+Shift+Tab", { ignoreWhileTyping: true }),
  action("session.next-waiting", "다음 대기 세션", "세션", "Ctrl+Shift+U", { ignoreWhileTyping: true }),
  action("session.resume", "재개", "세션", null),
  action("session.refresh", "새로고침", "세션", null),
  action("session.stop", "중지", "세션", null),
  action("session.remove", "제거", "세션", null),
  action("session.prompts", "프롬프트 라이브러리", "세션", null),
  action("session.deliveries", "보류 메시지 관리", "세션", null),
  action("notifications.snooze", "알림 1시간 끄기/다시 켜기", "세션", null),
  action("tools.claude-update", "Claude Code 업데이트", "세션", null),
  action("tools.codex-update", "Codex 업데이트", "세션", null),
  action("tools.edit-agents", "에이전트 추가", "세션", null),
  // 이동 — 키와 팔레트로만. 메뉴에 올리기엔 너무 잘다.
  ...Array.from({ length: 9 }, (_, index) =>
    action(`workspace.focus-slot-${index + 1}`, `슬롯 ${index + 1} 포커스`, "이동", `Ctrl+${index + 1}`, {
      ignoreWhileTyping: true,
    }),
  ),
  action("workspace.focus-left", "왼쪽 패인으로", "이동", "Ctrl+Alt+ArrowLeft", { ignoreWhileTyping: true }),
  action("workspace.focus-right", "오른쪽 패인으로", "이동", "Ctrl+Alt+ArrowRight", { ignoreWhileTyping: true }),
  action("workspace.focus-up", "위 패인으로", "이동", "Ctrl+Alt+ArrowUp", { ignoreWhileTyping: true }),
  action("workspace.focus-down", "아래 패인으로", "이동", "Ctrl+Alt+ArrowDown", { ignoreWhileTyping: true }),
  action("workspace.page-prev", "이전 페이지", "이동", "Ctrl+PageUp", { ignoreWhileTyping: true }),
  action("workspace.page-next", "다음 페이지", "이동", "Ctrl+PageDown", { ignoreWhileTyping: true }),
  // 터미널 — 터미널 우클릭 메뉴. 키는 TerminalPane이 직접 받으니 고정이다.
  action("edit.copy", "복사", "터미널", "Ctrl+Shift+C", { fixed: true, palette: false }),
  action("edit.paste", "붙여넣기", "터미널", "Ctrl+V", { fixed: true, palette: false }),
  // 키 표기가 없다: Ctrl+A는 TerminalPane이 가로채지 않고 셸로 간다(줄 맨 앞으로).
  action("edit.select-all", "모두 선택", "터미널", null, { fixed: true, palette: false }),
  action("edit.find", "찾기", "터미널", "Ctrl+F", { fixed: true }),
  action("edit.clear", "화면 지우기", "터미널", null, { fixed: true }),
  // 도움말
  action("help.check-updates", "업데이트 확인", "도움말", null),
  action("help.release-notes", "릴리스 노트", "도움말", null),
  action("help.repository", "GitHub 저장소", "도움말", null),
  action("help.keybindings", "단축키 보기", "도움말", null),
  // Ctrl+R 기본값은 의도적으로 없다 — 오타 한 번의 리로드가 세션 화면을 날린다.
  action("view.reload", "다시 로드", "도움말", null),
  action("view.dev-tools", "개발자 도구", "도움말", "F12"),
];

export function findKeymapAction(actionId: string): KeymapAction | undefined {
  return KEYMAP_ACTIONS.find((candidate) => candidate.id === actionId);
}

/** How the palette and the 단축키 tab name a command away from its menu: "세션: 중지". */
export function qualifiedLabel(command: Pick<KeymapAction, "category" | "label">, label = command.label): string {
  return `${command.category}: ${label}`;
}

/** Shift로 타이핑되는 글리프 — 표기는 기본 키로 하고 Shift는 표기에서 뺀다(현행 줌 키 동작과 일치). */
const SHIFT_GLYPHS: Record<string, string> = { "+": "=", _: "-" };

export function normalizeKeyEvent(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): string | null {
  const key = event.key;
  if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") return null;
  const glyph = SHIFT_GLYPHS[key];
  let normalized = glyph ?? (key === " " ? "Space" : key);
  if (normalized.length === 1) normalized = normalized.toUpperCase();
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey && glyph === undefined) parts.push("Shift");
  parts.push(normalized);
  return parts.join("+");
}

export function effectiveAccelerator(actionId: string, overrides: Record<string, string | null>): string | null {
  const found = findKeymapAction(actionId);
  if (!found) return null;
  if (found.fixed) return found.defaultAccelerator;
  const override = overrides[actionId];
  return override === undefined ? found.defaultAccelerator : override;
}

export function resolveKeymap(overrides: Record<string, string | null>): Map<string, KeymapAction> {
  const keymap = new Map<string, KeymapAction>();
  for (const candidate of KEYMAP_ACTIONS) {
    if (candidate.fixed) continue; // edit.*는 TerminalPane 소유 — 디스패처가 잡으면 반쪽 리매핑이 된다
    const accelerator = effectiveAccelerator(candidate.id, overrides);
    if (accelerator) keymap.set(accelerator, candidate);
  }
  return keymap;
}

export function findConflict(
  accelerator: string,
  overrides: Record<string, string | null>,
  excludeActionId: string,
): KeymapAction | null {
  for (const candidate of KEYMAP_ACTIONS) {
    if (candidate.id === excludeActionId) continue;
    if (effectiveAccelerator(candidate.id, overrides) === accelerator) return candidate;
  }
  return null;
}

export function isBindableAccelerator(accelerator: string): boolean {
  const parts = accelerator.split("+");
  const key = parts[parts.length - 1] ?? "";
  const modifiers = new Set(parts.slice(0, -1));
  if (/^F([1-9]|1[0-2])$/.test(key)) return true;
  // Shift만으로는 부족하다 — Shift+문자는 곧 대문자 타이핑이다. Ctrl이나 Alt가 있어야 한다.
  return modifiers.has("Ctrl") || modifiers.has("Alt");
}

/**
 * 슬롯 포커스류가 삼켜야 할 상황인지: 모달이 떠 있거나 텍스트 입력이 포커스를 쥐고 있다. 터미널은
 * xterm의 숨은 textarea로 키를 받지만 입력 필드가 아니다 — 세션 순환·슬롯 포커스는 거기서 동작해야 한다.
 */
export function isTypingTarget(): boolean {
  if (document.querySelector(".modal-backdrop")) return true;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  if (active.classList.contains("xterm-helper-textarea")) return false;
  if (active.isContentEditable) return true;
  return active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT";
}
