import { FileDiff, FolderOpen, Trash2 } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";
import { VSCodeIcon } from "./brand-icons";

export interface WorktreeContextMenuProps {
  branch: string;
  x: number;
  y: number;
  vscodeAvailable: boolean;
  onReveal(): void;
  onOpenInEditor(): void;
  onShowDiff(): void;
  onRemove(): void;
  onClose(): void;
}

export function WorktreeContextMenu({
  branch,
  x,
  y,
  vscodeAvailable,
  onReveal,
  onOpenInEditor,
  onShowDiff,
  onRemove,
  onClose,
}: WorktreeContextMenuProps) {
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
      aria-label={`${branch} worktree 작업`}
      ref={menu}
      style={{ "--context-menu-x": `${x}px`, "--context-menu-y": `${y}px` } as CSSProperties}
    >
      <button type="button" role="menuitem" onClick={run(onReveal)}>
        <FolderOpen size={15} />
        <span>파일 탐색기에서 열기</span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!vscodeAvailable}
        title={vscodeAvailable ? undefined : "PATH에서 VS Code를 찾을 수 없습니다"}
        onClick={run(onOpenInEditor)}
      >
        <VSCodeIcon size={15} className="brand-icon-vscode" />
        <span>VS Code에서 열기</span>
      </button>
      <button type="button" role="menuitem" onClick={run(onShowDiff)}>
        <FileDiff size={15} />
        <span>변경 보기</span>
      </button>
      <div className="context-menu-separator" role="separator" />
      <button type="button" role="menuitem" className="danger-item" onClick={run(onRemove)}>
        <Trash2 size={15} />
        <span>Worktree 제거</span>
      </button>
    </div>
  );
}
