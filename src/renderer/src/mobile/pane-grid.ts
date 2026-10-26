/** 넓은 화면 그리드의 칸 수 상한 — 메인 창의 자동 배치와 같이 1·2·4칸까지 나눈다. */
export const MAX_PANES = 4;

/**
 * 세션을 그리드에 놓는다. 이미 칸에 있으면 그대로, 빈 칸이 있으면 뒤에 붙이고, 가득 찼으면
 * 포커스 칸을 바꾼다 — 사용자가 보던 칸을 바꾸는 것이 가장 덜 놀랍다.
 */
export function placePane(panes: readonly string[], focusedId: string | null, sessionId: string): string[] {
  if (panes.includes(sessionId)) return [...panes];
  if (panes.length < MAX_PANES) return [...panes, sessionId];
  const index = focusedId ? panes.indexOf(focusedId) : -1;
  const target = index >= 0 ? index : panes.length - 1;
  return panes.map((id, position) => (position === target ? sessionId : id));
}

/** 칸 하나를 닫고, 포커스가 그 칸이었으면 옆 칸으로 옮긴다. */
export function closePane(
  panes: readonly string[],
  focusedId: string | null,
  sessionId: string,
): { panes: string[]; focusedId: string | null } {
  const index = panes.indexOf(sessionId);
  const next = panes.filter((id) => id !== sessionId);
  if (focusedId !== sessionId) return { panes: next, focusedId };
  return { panes: next, focusedId: next[Math.min(Math.max(index, 0), next.length - 1)] ?? null };
}

/** 그리드의 열 수 — 1칸은 1열, 그 이상은 2열. 3칸이면 마지막 칸이 아랫줄을 다 쓴다(CSS). */
export function gridColumns(count: number): number {
  return count <= 1 ? 1 : 2;
}

const PANES_KEY = "mcw.remote.panes.v1";

/** 열어 둔 칸은 페어링(기기) 단위로 둔다 — 셸이 여러 호스트를 오가도 서로 섞이지 않게. */
export function loadPanes(storage: Storage | null, deviceId: string): string[] {
  try {
    const raw = storage?.getItem(`${PANES_KEY}:${deviceId}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0).slice(0, MAX_PANES);
  } catch {
    return [];
  }
}

export function savePanes(storage: Storage | null, deviceId: string, panes: readonly string[]): void {
  try {
    storage?.setItem(`${PANES_KEY}:${deviceId}`, JSON.stringify(panes));
  } catch {
    /* unavailable storage */
  }
}
