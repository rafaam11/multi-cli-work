import type { FileTreeEntry } from "@shared/file-explorer-types";
import {
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Code2,
  Copy,
  FilePlus,
  FileText,
  Files,
  FolderOpen,
  FolderPlus,
  Pencil,
  Trash2,
  Type,
} from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";

export type FileTreeCopyKind = "absolute" | "relative" | "name";

export interface FileTreeContextMenuProps {
  /** Null when the click landed on the tree's empty space: the menu then acts on the root folder. */
  entry: FileTreeEntry | null;
  /** Only meaningful for a folder — it decides whether the first item folds or unfolds. */
  expanded: boolean;
  x: number;
  y: number;
  vscodeAvailable: boolean;
  onOpen(): void;
  onToggle(): void;
  onCreate(kind: "file" | "directory"): void;
  onCopy(kind: FileTreeCopyKind): void;
  onReveal(): void;
  onOpenInEditor(): void;
  onRename(): void;
  onDuplicate(): void;
  onDelete(): void;
  onClose(): void;
}

export function FileTreeContextMenu({
  entry,
  expanded,
  x,
  y,
  vscodeAvailable,
  onOpen,
  onToggle,
  onCreate,
  onCopy,
  onReveal,
  onOpenInEditor,
  onRename,
  onDuplicate,
  onDelete,
  onClose,
}: FileTreeContextMenuProps) {
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

  // The tree's empty space stands for the root folder, so it offers everything a folder does except
  // the operations that would act on the project itself (rename, duplicate, delete).
  const isFolder = !entry || entry.kind === "directory";

  return (
    <div
      className="context-menu"
      role="menu"
      aria-label={`${entry?.name ?? "루트 폴더"} 작업`}
      ref={menu}
      style={{ "--context-menu-x": `${x}px`, "--context-menu-y": `${y}px` } as CSSProperties}
    >
      {entry && entry.kind === "file" ? (
        <button type="button" role="menuitem" onClick={run(onOpen)}>
          <FileText size={15} />
          <span>열기</span>
        </button>
      ) : null}
      {entry && entry.kind === "directory" ? (
        <button type="button" role="menuitem" onClick={run(onToggle)}>
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <span>{expanded ? "접기" : "펼치기"}</span>
        </button>
      ) : null}
      {isFolder ? (
        <>
          <button type="button" role="menuitem" onClick={run(() => onCreate("file"))}>
            <FilePlus size={15} />
            <span>새 파일</span>
          </button>
          <button type="button" role="menuitem" onClick={run(() => onCreate("directory"))}>
            <FolderPlus size={15} />
            <span>새 폴더</span>
          </button>
        </>
      ) : null}

      <div className="context-menu-separator" role="separator" />
      <button type="button" role="menuitem" onClick={run(() => onCopy("absolute"))}>
        <Copy size={15} />
        <span>경로 복사</span>
      </button>
      {entry ? (
        <>
          <button type="button" role="menuitem" onClick={run(() => onCopy("relative"))}>
            <ClipboardCopy size={15} />
            <span>상대 경로 복사</span>
          </button>
          <button type="button" role="menuitem" onClick={run(() => onCopy("name"))}>
            <Type size={15} />
            <span>{entry.kind === "directory" ? "폴더 이름 복사" : "파일 이름 복사"}</span>
          </button>
        </>
      ) : null}

      <div className="context-menu-separator" role="separator" />
      <button type="button" role="menuitem" onClick={run(onReveal)}>
        <FolderOpen size={15} />
        <span>탐색기에서 표시</span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!vscodeAvailable}
        onClick={run(onOpenInEditor)}
        title={vscodeAvailable ? undefined : "VS Code를 찾지 못했습니다"}
      >
        <Code2 size={15} />
        <span>VS Code로 열기</span>
      </button>

      {entry ? (
        <>
          <div className="context-menu-separator" role="separator" />
          <button type="button" role="menuitem" onClick={run(onRename)}>
            <Pencil size={15} />
            <span>이름 변경</span>
          </button>
          <button type="button" role="menuitem" onClick={run(onDuplicate)}>
            <Files size={15} />
            <span>복제</span>
          </button>
          <button type="button" role="menuitem" className="danger-item" onClick={run(onDelete)}>
            <Trash2 size={15} />
            <span>삭제</span>
          </button>
        </>
      ) : null}
    </div>
  );
}
