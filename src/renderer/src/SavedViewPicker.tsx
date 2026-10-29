import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bookmark, Trash2 } from "lucide-react";
import type { SavedViewPreset, WorkbenchSnapshot, WorkbenchState } from "@shared/workbench-types";
import { isAutoLayout, layoutById } from "./grid-layouts";
import { errorMessage } from "./ipc-error";

export function SavedViewPicker({ current, onApply }: {
  current: Omit<SavedViewPreset, "id" | "name">; onApply(view: SavedViewPreset): void;
}) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setSnapshot(null); setError(null); setName("");
    void window.multiCliWork.workbench.state().then(value => { if (alive) setSnapshot(value); })
      .catch(cause => { if (alive) setError(errorMessage(cause)); });
    return () => { alive = false; trigger.current?.focus(); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); if (!busy) setOpen(false); }
      if (event.key === "Tab") {
        const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])];
        const first = focusable[0], last = focusable.at(-1);
        if (!dialog.current?.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, busy]);
  const run = async (action: () => Promise<WorkbenchState>) => {
    setBusy(true); setError(null);
    try { const state = await action(); setSnapshot(value => value ? { ...value, state } : value); setName(""); }
    catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  };
  const writable = snapshot?.writable === true && !busy;
  const views = snapshot?.state.savedViews ?? [];
  return <>
    <button ref={trigger} type="button" className="icon-button" title="이름으로 배치 저장·불러오기" aria-label="저장 배치" onClick={() => setOpen(true)}><Bookmark size={15} /></button>
    {open ? createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
      <section ref={dialog} className="confirm-dialog saved-view-dialog" role="dialog" aria-modal="true" aria-label="저장 배치">
        <h2>저장 배치</h2><p>화면 분할과 양쪽 패널 상태를 이름으로 저장합니다. 적용하면 현재 세션을 순서대로 다시 배치합니다.</p>
        {snapshot?.warning ? <p role="alert">{snapshot.warning}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <form onSubmit={event => { event.preventDefault(); void run(() => window.multiCliWork.workbench.saveView({ ...current,
          layoutId: isAutoLayout(current.layoutId) ? "auto" : layoutById(current.layoutId)?.id ?? "auto", id: crypto.randomUUID(), name: name.trim() })); }}>
          <label>배치 이름<input autoFocus maxLength={40} value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="예: 구현 + 리뷰" /></label>
          <button type="submit" disabled={!writable || !name.trim() || views.length >= 30}>현재 배치 저장</button>
        </form>
        <ul className="saved-view-list">{views.map(view => <li key={view.id}>
          <button type="button" disabled={busy} onClick={() => { onApply(view); setOpen(false); }}><strong>{view.name}</strong><span>{isAutoLayout(view.layoutId) ? "자동" : layoutById(view.layoutId)?.label} · 패널 상태 복원</span></button>
          <button type="button" disabled={!writable} aria-label={`${view.name} 배치 삭제`} onClick={() => void run(() => window.multiCliWork.workbench.removeView(view.id))}><Trash2 size={14} /></button>
        </li>)}</ul>
        {snapshot && !views.length ? <p>저장된 배치가 없습니다.</p> : null}
        <footer className="confirm-dialog-actions"><button type="button" disabled={busy} onClick={() => setOpen(false)}>닫기</button></footer>
      </section>
    </div>, document.body) : null}
  </>;
}
