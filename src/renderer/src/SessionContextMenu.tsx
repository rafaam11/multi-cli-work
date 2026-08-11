import { LayoutGrid, Pencil, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";

export interface SessionContextMenuProps {
  sessionLabel: string;
  x: number;
  y: number;
  /** A session that only carries its provider's fallback label has no custom name to clear. */
  canResetName: boolean;
  /**
   * 작업공간1/2/3 as targets for this session. Dragging a row onto the shelf does the same thing;
   * this is the path for anyone who would rather not drag. `contains` greys out a workspace that
   * already holds the session, because adding it twice is not a thing a workspace can do.
   */
  workspaces: { index: number; paneCount: number; contains: boolean }[];
  onAddToWorkspace(index: number): void;
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
  workspaces,
  onAddToWorkspace,
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
      {workspaces.length > 0 ? (
        <>
          <div className="context-menu-separator" role="separator" />
          <span className="context-menu-label">작업공간에 추가</span>
          {workspaces.map((workspace) => (
            <button
              key={workspace.index}
              type="button"
              role="menuitem"
              disabled={workspace.contains}
              onClick={run(() => onAddToWorkspace(workspace.index))}
              title={workspace.contains ? `작업공간${workspace.index + 1}에 이미 있습니다` : undefined}
            >
              <LayoutGrid size={15} />
              <span>
                작업공간{workspace.index + 1} ({workspace.paneCount})
              </span>
            </button>
          ))}
        </>
      ) : null}
      <div className="context-menu-separator" role="separator" />
      <button type="button" role="menuitem" className="danger-item" onClick={run(onRemove)}>
        <Trash2 size={15} />
        <span>제거</span>
      </button>
    </div>
  );
}
