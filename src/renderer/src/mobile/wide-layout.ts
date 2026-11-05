import { useEffect, useState } from "react";

/** 키보드와 마우스가 있는 큰 화면. 셸 여부와 무관해서 PC 브라우저도 같은 화면을 얻는다. */
export const WIDE_LAYOUT_QUERY = "(min-width: 760px) and (pointer: fine)";

/**
 * 넓은 화면이 아닌데 세션 목록을 옆 레일로 둘 만큼 폭이 되는 화면. 폴드를 펴면(933px) 레일, 접으면
 * (476px) 목록과 세션 화면을 오간다. 세로가 짧은 화면이 많아서 탐색은 위아래 줄 대신 옆으로 보낸다.
 */
export const RAIL_LAYOUT_QUERY = "(min-width: 600px)";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export function useWideLayout(): boolean {
  return useMediaQuery(WIDE_LAYOUT_QUERY);
}

/** 넓은 화면이면 false다 — 레일은 폰 배치 안의 한 가지 모양이다. */
export function useRailLayout(): boolean {
  const wide = useWideLayout();
  const rail = useMediaQuery(RAIL_LAYOUT_QUERY);
  return rail && !wide;
}

/** `#session=<id>` — 셸이 알림 등에서 특정 세션을 바로 열 때 쓴다. */
export function sessionIdFromHash(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get("session");
  return value && value.length > 0 ? value : null;
}

export function sessionHash(sessionId: string): string {
  return `#${new URLSearchParams({ session: sessionId }).toString()}`;
}
