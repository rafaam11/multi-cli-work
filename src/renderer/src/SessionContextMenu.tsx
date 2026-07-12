import { Pencil, RotateCcw } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";

export interface SessionContextMenuProps {
  sessionLabel: string;
  x: number;
  y: number;
  /** A session that only carries its provider's fallback label has no custom name to clear. */
  canResetName: boolean;
  onRename(): void;
  onResetName(): void;
  onClose(): void;
}

export function SessionContextMenu({
  sessionLabel,
  x,
  y,
  canResetName,
  onRename,
  onResetName,
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
      <button type="button" role="menuitem" onClick={run(onRename)}>
        <Pencil size={15} />
        <span>이름 변경</span>
      </button>
      <button type="button" role="menuitem" disabled={!canResetName} onClick={run(onResetName)}>
        <RotateCcw size={15} />
        <span>제공자 제목 사용</span>
      </button>
    </div>
  );
}
