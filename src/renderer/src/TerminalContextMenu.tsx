import { ClipboardPaste, Copy, Eraser, Search, TextSelect } from "lucide-react";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useClampedMenuPosition } from "./context-menu-position";
import { effectiveAccelerator, findKeymapAction } from "./keymap";

/** What the right-click menu asks the terminal it was opened on to do — the 터미널 commands. */
export type TerminalMenuAction = "edit.copy" | "edit.paste" | "edit.select-all" | "edit.find" | "edit.clear";

const ICONS: Record<TerminalMenuAction, ReactNode> = {
  "edit.copy": <Copy size={15} />,
  "edit.paste": <ClipboardPaste size={15} />,
  "edit.select-all": <TextSelect size={15} />,
  "edit.find": <Search size={15} />,
  "edit.clear": <Eraser size={15} />,
};

export interface TerminalContextMenuProps {
  x: number;
  y: number;
  /** Whether the terminal had text selected when the menu opened — 복사 has nothing to copy otherwise. */
  hasSelection: boolean;
  onAction(action: TerminalMenuAction): void;
  onClose(): void;
}

/**
 * The terminal's own right-click menu: what used to be the title bar's 편집 menu, moved onto the
 * thing it acts on. Labels and keys come from the command registry; the keys are fixed, because
 * TerminalPane handles them inside xterm.
 */
export function TerminalContextMenu({ x, y, hasSelection, onAction, onClose }: TerminalContextMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const position = useClampedMenuPosition(x, y, menu);

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

  const item = (action: TerminalMenuAction, disabled = false) => {
    const shortcut = effectiveAccelerator(action, {});
    return (
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        onClick={() => {
          onClose();
          onAction(action);
        }}
      >
        {ICONS[action]}
        <span className="context-menu-item-label">{findKeymapAction(action)?.label ?? action}</span>
        {shortcut ? <span className="context-menu-shortcut">{shortcut}</span> : null}
      </button>
    );
  };

  return (
    <div
      className="context-menu terminal-context-menu"
      role="menu"
      aria-label="터미널"
      ref={menu}
      style={{ "--context-menu-x": `${position.x}px`, "--context-menu-y": `${position.y}px` } as CSSProperties}
      // The menu must not take the selection 복사 is about to read.
      onMouseDown={(event) => event.preventDefault()}
    >
      {item("edit.copy", !hasSelection)}
      {item("edit.paste")}
      {item("edit.select-all")}
      <div className="context-menu-separator" role="separator" />
      {item("edit.find")}
      {item("edit.clear")}
    </div>
  );
}
