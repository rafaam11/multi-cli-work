import type { AppSettings } from "@shared/settings-types";
import { useEffect, useMemo, useRef } from "react";
import { isTypingTarget, normalizeKeyEvent, resolveKeymap } from "../keymap";

/**
 * 앱 전역 단축키. 키맵은 설정에서 오고, 눌린 키가 무엇을 할지는 App이 매 렌더 갱신하는 두 ref
 * (`handleMenuActionRef`, `keyActionEnabledRef`)로 묻는다 — 리스너는 한 번만 단다.
 */
export function useAppShortcuts(keybindings: AppSettings["keybindings"]) {
  const keymap = useMemo(() => resolveKeymap(keybindings), [keybindings]);
  const keymapRef = useRef(keymap);
  keymapRef.current = keymap;
  const handleMenuActionRef = useRef<(id: string) => void>(() => undefined);
  const keyActionEnabledRef = useRef<(id: string) => boolean>(() => true);

  // 캡처 단계여야 한다: 포커스된 xterm이 keydown을 삼키므로, 그보다 먼저 보는 리스너만이
  // 앱 전역 단축키가 될 수 있다. (예전의 Ctrl+P·줌·Ctrl+S 리스너 세 개를 키맵 조회 하나로 통합.)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector("[data-key-capture]")) return; // 단축키 탭이 키를 녹화하는 중
      const accelerator = normalizeKeyEvent(event);
      if (!accelerator) return;
      const matched = keymapRef.current.get(accelerator);
      if (!matched) return;
      if (matched.ignoreWhileTyping && isTypingTarget()) return;
      if (!matched.terminalSafe && document.activeElement?.closest(".xterm")) return;
      if (!keyActionEnabledRef.current(matched.id)) return; // preventDefault 없이 흘려보낸다 — 현행과 동일
      event.preventDefault();
      event.stopPropagation();
      handleMenuActionRef.current(matched.id);
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, []);

  return { keymap, handleMenuActionRef, keyActionEnabledRef };
}
