import type { TerminalSizeOwner } from "@shared/api-types";
import { useEffect, useState } from "react";

/**
 * 원격 기기(폰·다른 PC의 원격 창)가 터미널 크기를 가진 세션 → 그 기기 이름. 패인 머리줄이 "원격에서
 * 크기 사용 중"을 보이고 되찾기 버튼을 단다. 이 PC가 되찾으면 목록에서 빠진다.
 */
export function useRemoteSizeOwners(): Readonly<Record<string, string>> {
  const [owners, setOwners] = useState<Record<string, string>>({});

  useEffect(() => {
    let disposed = false;
    const apply = ({ sessionId, deviceName }: TerminalSizeOwner) =>
      setOwners((current) => {
        if (deviceName === null) {
          if (!(sessionId in current)) return current;
          const next = { ...current };
          delete next[sessionId];
          return next;
        }
        return current[sessionId] === deviceName ? current : { ...current, [sessionId]: deviceName };
      });
    void window.multiCliWork.terminals
      .sizeOwners()
      .then((list) => {
        if (!disposed) list.forEach(apply);
      })
      .catch(() => undefined);
    const unsubscribe = window.multiCliWork.terminals.onSizeOwner(apply);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  return owners;
}
