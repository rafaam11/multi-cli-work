import { Eye, EyeOff, Pencil, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";
import { SHELF_TEXT } from "./shelves";

export interface SessionContextMenuProps {
  sessionLabel: string;
  x: number;
  y: number;
  /** A session that only carries its provider's fallback label has no custom name to clear. */
  canResetName: boolean;
  /**
   * Whether this session sits on 숨김 rather than 작업공간. Every session is on one of the two, so
   * the menu offers the move as a single toggle rather than a list of places to add it to.
   */
  hidden: boolean;
  onToggleHidden(): void;
  onRefresh(): void;
  onRename(): void;
  onResetName(): void;
  onRemove(): void;
  onClose(): void;
}

export function SessionContextMenu({
  sessionLabel,
  x,
  y,
  canResetName,
  hidden,
  onToggleHidden,
  onRefresh,
  onRename,
  onResetName,
  onRemove,
  onClose,
}: SessionContextMenuProps) {
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <div
      className="context-menu"
      role="menu"
      aria-label={`${sessionLabel} 작업`}
      ref={menu}
      style={{ "--context-menu-x": `${x}px`, "--context-menu-y": `${y}px` } as CSSProperties}
    >
      <button type="button" role="menuitem" onClick={run(onRefresh)}>
        <RefreshCw size={15} />
        <span>새로고침</span>
      </button>
      <button type="button" role="menuitem" onClick={run(onRename)}>
        <Pencil size={15} />
        <span>이름 변경</span>
      </button>
      <button type="button" role="menuitem" disabled={!canResetName} onClick={run(onResetName)}>
        <RotateCcw size={15} />
        <span>제공자 제목 사용</span>
      </button>
      <div className="context-menu-separator" role="separator" />
      <button
        type="button"
        role="menuitem"
        onClick={run(onToggleHidden)}
        title={SHELF_TEXT[hidden ? "hidden" : "active"].moveTitle}
      >
        {hidden ? <Eye size={15} /> : <EyeOff size={15} />}
        <span>{SHELF_TEXT[hidden ? "hidden" : "active"].move}</span>
      </button>
      <div className="context-menu-separator" role="separator" />
      <button type="button" role="menuitem" className="danger-item" onClick={run(onRemove)}>
        <Trash2 size={15} />
        <span>제거</span>
      </button>
    </div>
  );
}
