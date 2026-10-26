import { useCallback, useEffect, useRef, useState } from "react";

const isDrawer = () => window.history.state?.mcw === "drawer";

/** A transient entry lets WebView/browser Back dismiss the overlay before navigating. */
export function useSessionDrawer() {
  const [isOpen, setOpen] = useState(false);
  const afterClose = useRef<(() => void) | undefined>();
  const closing = useRef(false);
  useEffect(() => {
    const pop = () => {
      setOpen(isDrawer());
      closing.current = false;
      const next = afterClose.current;
      afterClose.current = undefined;
      next?.();
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const open = useCallback(() => {
    if (!isDrawer()) window.history.pushState({ mcw: "drawer" }, "", window.location.href);
    setOpen(true);
  }, []);
  const close = useCallback((next?: () => void) => {
    if (closing.current) return;
    if (isDrawer()) {
      closing.current = true;
      afterClose.current = next;
      window.history.back();
    } else {
      setOpen(false);
      next?.();
    }
  }, []);
  return { isOpen, open, close };
}
