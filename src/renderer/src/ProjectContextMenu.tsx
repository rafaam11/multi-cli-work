import { FolderOpen, Pencil, Trash2 } from "lucide-react";
import { GitHubIcon, VSCodeIcon } from "./brand-icons";
import { useEffect, useRef, type CSSProperties } from "react";

export interface ProjectContextMenuProps {
  projectName: string;
  x: number;
  y: number;
  vscodeAvailable: boolean;
  onReveal(): void;
  onOpenInEditor(): void;
  onOpenOnGitHub(): void;
  onRename(): void;
  onRemove(): void;
  onClose(): void;
}

export function ProjectContextMenu({
  projectName,
  x,
  y,
  vscodeAvailable,
  onReveal,
  onOpenInEditor,
  onOpenOnGitHub,
  onRename,
  onRemove,
  onClose,
}: ProjectContextMenuProps) {
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
      aria-label={`${projectName} 작업`}
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
      <button type="button" role="menuitem" onClick={run(onOpenOnGitHub)}>
        <GitHubIcon size={15} />
        <span>GitHub에서 열기</span>
      </button>
      <div className="context-menu-separator" role="separator" />
      <button type="button" role="menuitem" onClick={run(onRename)}>
        <Pencil size={15} />
        <span>이름 변경</span>
      </button>
      <button type="button" role="menuitem" className="danger-item" onClick={run(onRemove)}>
        <Trash2 size={15} />
        <span>목록에서 제거</span>
      </button>
    </div>
  );
}
