import { useEffect, useRef } from "react";

/**
 * Closes a dropdown when the next press lands outside it. Shared by every menu in the app so they
 * all dismiss the same way — and so a menu can never be left open behind the surface it covers.
 */
export function useDismissable<T extends HTMLElement = HTMLDivElement>(onDismiss: () => void) {
  const anchor = useRef<T>(null);
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!anchor.current?.contains(event.target as Node)) onDismiss();
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [onDismiss]);
  return anchor;
}
