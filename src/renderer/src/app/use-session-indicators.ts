import type { SessionIndicators, SessionIndicatorsUpdate } from "@shared/terminal-types";
import { useEffect, useState } from "react";

/**
 * 세션 → 패인 머리줄에 보일 진행률·상태 칩. 아무것도 보이지 않는 세션은 목록에 없다. 세션이 끝나면
 * main이 빈 값을 보내 지운다.
 */
export function useSessionIndicators(): Readonly<Record<string, SessionIndicators>> {
  const [indicators, setIndicators] = useState<Record<string, SessionIndicators>>({});

  useEffect(() => {
    let disposed = false;
    const apply = ({ sessionId, indicators: next }: SessionIndicatorsUpdate) =>
      setIndicators((current) => {
        if (next.progress === null && next.chips.length === 0) {
          if (!(sessionId in current)) return current;
          const rest = { ...current };
          delete rest[sessionId];
          return rest;
        }
        return { ...current, [sessionId]: next };
      });
    void window.multiCliWork.terminals
      .indicators()
      .then((list) => {
        if (!disposed) list.forEach(apply);
      })
      .catch(() => undefined);
    const unsubscribe = window.multiCliWork.terminals.onIndicators(apply);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  return indicators;
}
