/**
 * The single source of truth for keyboard shortcuts. Action ids are the cases of App.tsx's
 * handleMenuAction switch — this catalog is an index over that switch, not a new execution path.
 * The menu bar derives its shortcut labels from here, so a remap changes the label with it.
 */

export type KeymapCategory = "일반" | "보기" | "세션" | "편집";

export const KEYMAP_CATEGORY_ORDER: readonly KeymapCategory[] = ["일반", "보기", "세션", "편집"];

export interface KeymapAction {
  id: string;
  label: string;
  category: KeymapCategory;
  defaultAccelerator: string | null;
  /** 터미널이 키보드를 쥐고 있어도 디스패처가 가로챈다(캡처 단계). */
  terminalSafe: boolean;
  /** 모달·텍스트 입력이 포커스를 쥔 동안은 무시한다 — 슬롯 포커스·세션 순환류. */
  ignoreWhileTyping: boolean;
  /** 리매핑 불가 — 표시만 된다. edit.*는 TerminalPane의 터미널 의미론과 결합되어 있다. */
  fixed: boolean;
}

const action = (
  id: string,
  label: string,
  category: KeymapCategory,
  defaultAccelerator: string | null,
  options?: Partial<Pick<KeymapAction, "terminalSafe" | "ignoreWhileTyping" | "fixed">>,
): KeymapAction => ({
  id,
  label,
  category,
  defaultAccelerator,
  terminalSafe: options?.terminalSafe ?? true,
  ignoreWhileTyping: options?.ignoreWhileTyping ?? false,
  fixed: options?.fixed ?? false,
});

export const KEYMAP_ACTIONS: readonly KeymapAction[] = [
  action("view.quick-open", "빠른 열기", "일반", "Ctrl+P"),
  action("file.save", "파일 저장", "일반", "Ctrl+S"),
  action("settings.open", "설정 열기", "일반", "Ctrl+,"),
  action("view.zoom-in", "확대", "보기", "Ctrl+="),
  action("view.zoom-out", "축소", "보기", "Ctrl+-"),
  action("view.zoom-reset", "원래 크기", "보기", "Ctrl+0"),
  action("view.full-screen", "전체 화면", "보기", "F11"),
  action("view.dev-tools", "개발자 도구", "보기", "F12"),
  // Ctrl+R 기본값은 의도적으로 없다 — 오타 한 번의 리로드가 세션 화면을 날린다.
  action("view.reload", "다시 로드", "보기", null),
  action("session.refresh", "세션 새로고침", "세션", "F5"),
  action("session.next", "다음 세션", "세션", "Ctrl+Tab", { ignoreWhileTyping: true }),
  action("session.prev", "이전 세션", "세션", "Ctrl+Shift+Tab", { ignoreWhileTyping: true }),
  ...Array.from({ length: 9 }, (_, index) =>
    action(`workspace.focus-slot-${index + 1}`, `슬롯 ${index + 1} 포커스`, "세션", `Ctrl+${index + 1}`, {
      ignoreWhileTyping: true,
    }),
  ),
  action("edit.copy", "복사", "편집", "Ctrl+Shift+C", { fixed: true }),
  action("edit.paste", "붙여넣기", "편집", "Ctrl+V", { fixed: true }),
  action("edit.select-all", "모두 선택", "편집", "Ctrl+A", { fixed: true }),
  action("edit.clear", "터미널 지우기", "편집", null, { fixed: true }),
];

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
  const found = KEYMAP_ACTIONS.find((candidate) => candidate.id === actionId);
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

/** 슬롯 포커스류가 삼켜야 할 상황인지: 모달이 떠 있거나 텍스트 입력이 포커스를 쥐고 있다. */
export function isTypingTarget(): boolean {
  if (document.querySelector(".modal-backdrop")) return true;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  if (active.isContentEditable) return true;
  return active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT";
}
