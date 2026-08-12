import { useLayoutEffect, useState, type RefObject } from "react";

/** Breathing room between a menu and the window edge it was pushed away from. */
const EDGE_MARGIN = 8;

/**
 * Keeps a context menu inside the window. The menus open at the pointer, so one opened near an edge
 * hangs past it — and what hangs past the bottom is the end of the list, where the destructive items
 * live. Measuring after mount is what makes this work for menus whose height depends on their
 * content: the agent list differs per folder, and a worktree menu carries rows a folder's does not.
 *
 * A menu taller than the window cannot be moved into it; `.context-menu` scrolls in that case.
 */
export function useClampedMenuPosition(
  x: number,
  y: number,
  menu: RefObject<HTMLElement | null>,
): { x: number; y: number } {
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    setPosition({
      x: Math.max(EDGE_MARGIN, Math.min(x, window.innerWidth - width - EDGE_MARGIN)),
      y: Math.max(EDGE_MARGIN, Math.min(y, window.innerHeight - height - EDGE_MARGIN)),
    });
  }, [x, y, menu]);

  return position;
}
