import { useCallback, useEffect, useState } from "react";

/**
 * 패인 하나를 그리드 전체로 잠시 키운다(저장하지 않는다). 확대 중에 포커스가 같은 페이지의 다른
 * 패인으로 가면(Ctrl+Tab, Ctrl+숫자, 사이드바) 확대도 그 패인을 따라간다 — 다른 패인은 숨어 있으니
 * 따라가지 않으면 포커스가 안 보이는 곳으로 간다. 패인이 페이지를 떠나거나 배치·화면이 바뀌면 풀린다.
 */
export function usePaneZoom(visiblePaneIds: readonly string[], focusedPaneId: string | null, resetKey: string) {
  const [zoomed, setZoomed] = useState<string | null>(null);

  useEffect(() => {
    setZoomed(null);
  }, [resetKey]);

  useEffect(() => {
    setZoomed((current) =>
      current !== null && focusedPaneId !== null && focusedPaneId !== current && visiblePaneIds.includes(focusedPaneId)
        ? focusedPaneId
        : current,
    );
    // Only a focus change moves the zoom; the page changing under it is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedPaneId]);

  const zoomedPaneId = zoomed !== null && visiblePaneIds.includes(zoomed) ? zoomed : null;
  const toggleZoom = useCallback((paneId: string) => setZoomed((current) => (current === paneId ? null : paneId)), []);
  const clearZoom = useCallback(() => setZoomed(null), []);
  return { zoomedPaneId, toggleZoom, clearZoom };
}
