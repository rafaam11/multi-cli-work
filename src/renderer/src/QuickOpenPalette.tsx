import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { rankQuickOpen, type QuickOpenItem } from "./quick-open";

const KIND_LABELS: Record<QuickOpenItem["kind"], string> = {
  session: "세션",
  project: "폴더",
  workspace: "작업공간",
  workProject: "프로젝트",
  command: "명령",
};

interface QuickOpenPaletteProps {
  initialKind?: QuickOpenItem["kind"] | "all";
  currentProjectId?: string | null;
  /** Everything reachable, in the order an empty query should show it (most useful first). */
  items: QuickOpenItem[];
  onSelect(item: QuickOpenItem): void;
  onClose(): void;
}

export function QuickOpenPalette({ items, onSelect, onClose, currentProjectId, initialKind = "all" }: QuickOpenPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [kind, setKind] = useState<QuickOpenItem["kind"] | "all">(initialKind);
  const [localOnly, setLocalOnly] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  // 전체(Ctrl+P)는 이동만 — 명령은 명령 칩(Ctrl+Shift+P)에서만 찾는다. 명령은 전부 보여 주고 스크롤한다.
  const ranked = useMemo(() => rankQuickOpen(items.filter(item =>
    (kind === "all" ? item.kind !== "command" : item.kind === kind) &&
    (!localOnly || !currentProjectId || item.projectId === currentProjectId || item.kind === "command" && !item.projectId)), query,
    kind === "command" ? Number.POSITIVE_INFINITY : 10), [items, query, kind, localOnly, currentProjectId]);
  const active = ranked[Math.min(activeIndex, ranked.length - 1)] ?? null;

  // With every command listed the arrow keys walk past the visible rows; the chosen one stays in view.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (ranked.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      const current = Math.min(activeIndex, ranked.length - 1);
      setActiveIndex((current + step + ranked.length) % ranked.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active) onSelect(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="modal-backdrop quick-open-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="quick-open" role="dialog" aria-modal="true" aria-label="빠른 열기">
        <div className="quick-open-filters" role="group" aria-label="검색 범위">
          {currentProjectId ? <button type="button" aria-pressed={localOnly} onClick={() => { setLocalOnly(value => !value); setActiveIndex(0); }}>현재 저장소</button> : null}
          {(["all", "session", "project", "workspace", "workProject", "command"] as const).map(value =>
            <button type="button" key={value} aria-pressed={kind === value}
              onClick={() => { setKind(value); setActiveIndex(0); }}>
              {value === "all" ? "전체" : KIND_LABELS[value]}
            </button>)}
        </div>
        <input
          type="text"
          className="quick-open-input"
          placeholder={kind === "command" ? "명령 검색" : "세션·폴더 검색"}
          aria-label="빠른 열기 검색"
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />
        {ranked.length === 0 ? (
          <p className="quick-open-empty">결과 없음</p>
        ) : (
          <ul className="quick-open-list" role="listbox" aria-label="빠른 열기 결과" ref={list}>
            {ranked.map((item, index) => (
              <li key={item.key} role="option" aria-selected={item === active}>
                <button
                  type="button"
                  className={`quick-open-item ${item === active ? "active" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => onSelect(item)}
                >
                  <span className={`quick-open-kind kind-${item.kind}`}>{KIND_LABELS[item.kind]}</span>
                  <span className="quick-open-label">{item.label}</span>
                  {item.detail ? (
                    <span className="quick-open-detail" title={item.detail}>
                      {item.detail}
                    </span>
                  ) : null}
                  {item.shortcut ? <kbd className="quick-open-shortcut">{item.shortcut}</kbd> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
        <footer className="quick-open-hints">↑ ↓ 선택 · Enter 열기 · Esc 닫기</footer>
      </div>
    </div>
  );
}
