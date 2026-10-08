import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  DEFAULT_RIGHT_SIDEBAR_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_RIGHT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_RIGHT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MIN_WORKSPACE_WIDTH,
  RIGHT_SIDEBAR_RAIL_WIDTH,
  SIDEBAR_RAIL_WIDTH,
  SIDEBAR_RESIZER_WIDTH,
} from "./app-model";

/**
 * 좌우 사이드바의 폭과 접힘. 두 폭은 서로의 최대값을 정한다 — 작업 영역이 MIN_WORKSPACE_WIDTH 밑으로
 * 줄지 않게. 창 크기가 바뀌면 둘 다 다시 맞추고, 경계를 끌면 그 폭을 따른다.
 */
export function useSidebarLayout() {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(DEFAULT_RIGHT_SIDEBAR_WIDTH);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);

  const rightSidebarSpace = rightSidebarCollapsed ? RIGHT_SIDEBAR_RAIL_WIDTH : rightSidebarWidth;

  const maximumSidebarWidth = useCallback(
    () =>
      Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(
          MAX_SIDEBAR_WIDTH,
          window.innerWidth - MIN_WORKSPACE_WIDTH - SIDEBAR_RESIZER_WIDTH - rightSidebarSpace - SIDEBAR_RESIZER_WIDTH,
        ),
      ),
    [rightSidebarSpace],
  );

  const clampSidebarWidth = useCallback(
    (width: number) => Math.min(maximumSidebarWidth(), Math.max(MIN_SIDEBAR_WIDTH, width)),
    [maximumSidebarWidth],
  );

  const leftSidebarSpace = sidebarCollapsed ? SIDEBAR_RAIL_WIDTH : sidebarWidth;

  const maximumRightSidebarWidth = useCallback(
    () =>
      Math.max(
        MIN_RIGHT_SIDEBAR_WIDTH,
        Math.min(
          MAX_RIGHT_SIDEBAR_WIDTH,
          window.innerWidth - MIN_WORKSPACE_WIDTH - SIDEBAR_RESIZER_WIDTH - leftSidebarSpace - SIDEBAR_RESIZER_WIDTH,
        ),
      ),
    [leftSidebarSpace],
  );

  const clampRightSidebarWidth = useCallback(
    (width: number) => Math.min(maximumRightSidebarWidth(), Math.max(MIN_RIGHT_SIDEBAR_WIDTH, width)),
    [maximumRightSidebarWidth],
  );

  useEffect(() => {
    const handleWindowResize = () => {
      setSidebarWidth((current) => clampSidebarWidth(current));
      setRightSidebarWidth((current) => clampRightSidebarWidth(current));
    };
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [clampSidebarWidth, clampRightSidebarWidth]);

  const beginSidebarResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      document.body.classList.add("sidebar-resizing");
      const handleMouseMove = (moveEvent: MouseEvent) => setSidebarWidth(clampSidebarWidth(moveEvent.clientX));
      const handleMouseUp = () => {
        document.body.classList.remove("sidebar-resizing");
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [clampSidebarWidth],
  );

  const beginRightSidebarResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      document.body.classList.add("sidebar-resizing");
      // The right sidebar is anchored to the window's right edge, so its width is the distance
      // from the pointer to that edge — the mirror image of the left sidebar's clientX tracking.
      const handleMouseMove = (moveEvent: MouseEvent) =>
        setRightSidebarWidth(clampRightSidebarWidth(window.innerWidth - moveEvent.clientX));
      const handleMouseUp = () => {
        document.body.classList.remove("sidebar-resizing");
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [clampRightSidebarWidth],
  );

  return {
    sidebarWidth,
    sidebarCollapsed,
    setSidebarCollapsed,
    rightSidebarWidth,
    rightSidebarCollapsed,
    setRightSidebarCollapsed,
    maximumSidebarWidth,
    maximumRightSidebarWidth,
    beginSidebarResize,
    beginRightSidebarResize,
  };
}
