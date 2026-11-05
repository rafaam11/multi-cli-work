import { useCallback, useEffect, useRef, useState } from "react";

/** 오버레이마다 다른 이름 — 서랍과 시트가 서로의 history 항목을 자기 것으로 읽지 않게. */
export type OverlayName = "drawer" | "session-menu" | "new-session" | "host-menu" | "rail-host-menu";

const isEntry = (name: OverlayName) => window.history.state?.mcw === name;

/**
 * 서랍·하단 시트처럼 화면 위에 잠깐 뜨는 것. 여는 동안 history 항목을 하나 쌓아서 WebView·브라우저의
 * 뒤로가기가 화면을 떠나기 전에 이것부터 닫게 한다. URL은 그대로라 세션 해시는 바뀌지 않는다.
 */
export function useOverlayEntry(name: OverlayName) {
  const [isOpen, setOpen] = useState(false);
  const afterClose = useRef<(() => void) | undefined>();
  const closing = useRef(false);
  useEffect(() => {
    const pop = () => {
      setOpen(isEntry(name));
      closing.current = false;
      const next = afterClose.current;
      afterClose.current = undefined;
      next?.();
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [name]);
  const open = useCallback(() => {
    if (!isEntry(name)) window.history.pushState({ mcw: name }, "", window.location.href);
    setOpen(true);
  }, [name]);
  const close = useCallback((next?: () => void) => {
    if (closing.current) return;
    if (isEntry(name)) {
      closing.current = true;
      afterClose.current = next;
      window.history.back();
    } else {
      setOpen(false);
      next?.();
    }
  }, [name]);
  return { isOpen, open, close };
}

/** A transient entry lets WebView/browser Back dismiss the overlay before navigating. */
export function useSessionDrawer() {
  return useOverlayEntry("drawer");
}
