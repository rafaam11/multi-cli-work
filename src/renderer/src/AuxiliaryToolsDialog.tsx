import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { TerminalSessionView } from "@shared/api-types";
import { PromptWorkbench } from "./PromptWorkbench";
import { DeliveryPanel } from "./DeliveryPanel";

export type AuxiliaryTool = "prompts" | "deliveries";

/** Tools stay mounted: closing a dialog must not discard an unsaved prompt. */
export function AuxiliaryToolsDialog({ tool, sessions, onFocusSession, onClose }: {
  tool: AuxiliaryTool | null; sessions: TerminalSessionView[];
  onFocusSession(session: TerminalSessionView): void; onClose(): void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!tool) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') ?? [])]
      .filter(element => !element.closest("[hidden]") && !element.closest("details:not([open]) :not(summary)"));
    dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close.current(); }
      if (event.key === "Tab") {
        const elements = focusable(); const first = elements[0]; const last = elements.at(-1);
        if (!dialog.current?.contains(document.activeElement) || document.activeElement === dialog.current) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      // A newly opened dialog may already have focused its input during commit.
      if (previous?.isConnected && (dialog.current?.contains(document.activeElement) || document.activeElement === document.body)) previous.focus();
    };
  }, [tool]);
  return createPortal(<div className={`${tool ? "modal-backdrop " : ""}auxiliary-tools-backdrop`} hidden={!tool} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} className="confirm-dialog auxiliary-tools-dialog" role="dialog" aria-modal="true" aria-label={tool === "prompts" ? "프롬프트 라이브러리" : "보류 메시지 관리"} tabIndex={-1}>
      <PromptWorkbench hidden={tool !== "prompts"} sessions={sessions} onFocusSession={session => { onFocusSession(session); onClose(); }} />
      <DeliveryPanel hidden={tool !== "deliveries"} sessions={sessions} onFocusSession={session => { onFocusSession(session); onClose(); }} />
      <footer className="confirm-dialog-actions"><button type="button" onClick={onClose}>닫기</button></footer>
    </div>
  </div>, document.body);
}
