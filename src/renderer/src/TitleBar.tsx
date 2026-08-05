import type { SessionAttention } from "@shared/api-types";
import { ChevronRight, Copy, Minus, MonitorDot, Search, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { TitleBarEntry, TitleBarMenu } from "./title-bar-menu";
import { useDismissable } from "./use-dismissable";

interface TitleBarProps {
  menus: TitleBarMenu[];
  onAction(id: string): void;
  /** The 업무 프로젝트 the command centre names, when the open folder belongs to one. */
  workProjectName: string | null;
  folderName: string | null;
  /** What the off-screen sessions are waiting for, or null when none of them are. */
  attention: SessionAttention | null;
  onQuickOpen(): void;
}

const ATTENTION_MARK: Record<SessionAttention, { mark: string; label: string }> = {
  approval: { mark: "!", label: "승인을 기다리는 세션이 있습니다" },
  input: { mark: "●", label: "입력을 기다리는 세션이 있습니다" },
};

export function TitleBar({ menus, onAction, workProjectName, folderName, attention, onQuickOpen }: TitleBarProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const menuButtons = useRef(new Map<string, HTMLButtonElement>());

  const closeMenus = useCallback(() => {
    setOpenMenuId(null);
    setOpenSubmenuId(null);
  }, []);
  const menuBar = useDismissable(closeMenus);

  useEffect(() => {
    void window.multiCliWork.window
      .state()
      .then((state) => setMaximized(state.maximized))
      .catch(() => undefined);
    return window.multiCliWork.window.onStateChange((state) => setMaximized(state.maximized));
  }, []);

  /**
   * Focus, not an index, is the source of truth for where the keyboard is in a menu: the buttons are
   * already in the document in the order they are read, and `data-menu-list` says which list each
   * one belongs to, so an open submenu never steals its parent's arrow keys.
   */
  const moveFocus = (listId: string, delta: number) => {
    const items = [...(menuBar.current?.querySelectorAll<HTMLButtonElement>(`button[data-menu-list="${listId}"]`) ?? [])]
      .filter((item) => !item.disabled);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = index === -1 ? (delta > 0 ? 0 : items.length - 1) : (index + delta + items.length) % items.length;
    items[next]?.focus();
  };

  const openMenu = (menuId: string) => {
    setOpenMenuId(menuId);
    setOpenSubmenuId(null);
    menuButtons.current.get(menuId)?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!openMenuId) return;
    const listId = openSubmenuId ?? openMenuId;
    const focused = document.activeElement as HTMLElement | null;

    if (event.key === "Escape") {
      event.preventDefault();
      if (openSubmenuId) {
        setOpenSubmenuId(null);
        menuBar.current?.querySelector<HTMLButtonElement>(`button[data-submenu-id="${openSubmenuId}"]`)?.focus();
        return;
      }
      const menuId = openMenuId;
      closeMenus();
      menuButtons.current.get(menuId)?.focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(listId, event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "ArrowRight" && focused?.dataset.submenuId) {
      event.preventDefault();
      setOpenSubmenuId(focused.dataset.submenuId);
      return;
    }
    if (event.key === "ArrowLeft" && openSubmenuId) {
      event.preventDefault();
      setOpenSubmenuId(null);
      menuBar.current?.querySelector<HTMLButtonElement>(`button[data-submenu-id="${openSubmenuId}"]`)?.focus();
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const index = menus.findIndex((menu) => menu.id === openMenuId);
      const step = event.key === "ArrowRight" ? 1 : -1;
      const next = menus[(index + step + menus.length) % menus.length];
      if (next) openMenu(next.id);
    }
  };

  // A submenu that has just opened should already have the keyboard, the way a flyout does.
  useEffect(() => {
    if (!openSubmenuId) return;
    menuBar.current?.querySelector<HTMLButtonElement>(`button[data-menu-list="${openSubmenuId}"]:not(:disabled)`)?.focus();
  }, [openSubmenuId, menuBar]);

  const renderEntry = (entry: TitleBarEntry, listId: string, index: number) => {
    if (entry.kind === "separator") {
      return <div key={`separator-${listId}-${index}`} className="title-bar-separator" role="separator" />;
    }
    if (entry.kind === "submenu") {
      const expanded = openSubmenuId === entry.id;
      return (
        <div className="title-bar-submenu-anchor" key={entry.id}>
          <button
            type="button"
            role="menuitem"
            data-menu-list={listId}
            data-submenu-id={entry.id}
            disabled={entry.disabled}
            aria-haspopup="menu"
            aria-expanded={expanded}
            onMouseEnter={() => {
              if (!entry.disabled) setOpenSubmenuId(entry.id);
            }}
            onClick={() => setOpenSubmenuId(expanded ? null : entry.id)}
          >
            <span className="title-bar-item-label">{entry.label}</span>
            <ChevronRight size={13} aria-hidden="true" />
          </button>
          {expanded ? (
            <div className="provider-menu title-bar-submenu" role="menu" aria-label={entry.label}>
              {entry.items.map((child, childIndex) => renderEntry(child, entry.id, childIndex))}
            </div>
          ) : null}
        </div>
      );
    }
    return (
      <button
        key={entry.id}
        type="button"
        role="menuitem"
        data-menu-list={listId}
        disabled={entry.disabled}
        onMouseEnter={() => {
          if (listId === openMenuId) setOpenSubmenuId(null);
        }}
        onClick={() => {
          closeMenus();
          onAction(entry.id);
        }}
      >
        <span className="title-bar-item-label">{entry.label}</span>
        {entry.shortcut ? <span className="title-bar-shortcut">{entry.shortcut}</span> : null}
      </button>
    );
  };

  const commandCentreLabel = [workProjectName, folderName].filter(Boolean).join(" / ") || "멀티 터미널 작업기";
  const attentionMark = attention ? ATTENTION_MARK[attention] : null;

  return (
    <div className="title-bar">
      <div className="title-bar-menus" role="menubar" ref={menuBar} onKeyDown={handleKeyDown}>
        <span className="title-bar-icon" aria-hidden="true">
          <MonitorDot size={15} />
        </span>
        {menus.map((menu) => (
          <div className="title-bar-menu-anchor" key={menu.id}>
            <button
              type="button"
              role="menuitem"
              className={`title-bar-menu-button ${openMenuId === menu.id ? "open" : ""}`}
              aria-haspopup="menu"
              aria-expanded={openMenuId === menu.id}
              ref={(node) => {
                if (node) menuButtons.current.set(menu.id, node);
                else menuButtons.current.delete(menu.id);
              }}
              // Once one menu is open the bar behaves like a menu bar: hovering switches.
              onMouseEnter={() => {
                if (openMenuId && openMenuId !== menu.id) {
                  setOpenMenuId(menu.id);
                  setOpenSubmenuId(null);
                }
              }}
              onClick={() => (openMenuId === menu.id ? closeMenus() : openMenu(menu.id))}
            >
              {menu.label}
            </button>
            {openMenuId === menu.id ? (
              <div className="provider-menu title-bar-dropdown" role="menu" aria-label={menu.label}>
                {menu.entries.map((entry, index) => renderEntry(entry, menu.id, index))}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="title-bar-command-centre">
        <button type="button" className="command-centre" onClick={onQuickOpen} aria-label="빠른 열기">
          <Search size={13} aria-hidden="true" />
          <span className="command-centre-label">{commandCentreLabel}</span>
        </button>
        {/* The window title carries the same mark for the taskbar; this one is for the eye already
            on the app but looking at a different session. */}
        {attentionMark ? (
          <span className={`command-centre-attention attention-${attention}`} role="status" aria-label={attentionMark.label}>
            {attentionMark.mark}
          </span>
        ) : null}
      </div>

      <div className="window-controls">
        <button type="button" aria-label="최소화" onClick={() => void window.multiCliWork.window.minimize()}>
          <Minus size={15} />
        </button>
        <button
          type="button"
          aria-label={maximized ? "이전 크기로 복원" : "최대화"}
          onClick={() => void window.multiCliWork.window.toggleMaximize()}
        >
          {maximized ? <Copy size={13} /> : <Square size={13} />}
        </button>
        <button
          type="button"
          className="window-close"
          aria-label="닫기"
          onClick={() => void window.multiCliWork.window.close()}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
