import { useEffect, useState } from "react";

/** 키보드와 마우스가 있는 큰 화면. 셸 여부와 무관해서 PC 브라우저도 같은 화면을 얻는다. */
export const WIDE_LAYOUT_QUERY = "(min-width: 900px) and (pointer: fine)";

export function useWideLayout(): boolean {
  const [wide, setWide] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia(WIDE_LAYOUT_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(WIDE_LAYOUT_QUERY);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

/** `#session=<id>` — 셸이 알림 등에서 특정 세션을 바로 열 때 쓴다. */
export function sessionIdFromHash(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get("session");
  return value && value.length > 0 ? value : null;
}
