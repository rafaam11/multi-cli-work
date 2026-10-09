import type { UsageSnapshot } from "@shared/usage-types";
import { useCallback, useEffect, useState } from "react";

const EMPTY: UsageSnapshot = { claude: null, codex: null };

/** 타이틀바 게이지가 보이는 Claude·Codex 구독 사용량. main이 갱신할 때마다 따라온다. */
export function useUsage() {
  const [usage, setUsage] = useState<UsageSnapshot>(EMPTY);

  useEffect(() => {
    let disposed = false;
    void window.multiCliWork.usage
      .state()
      .then((snapshot) => {
        if (!disposed) setUsage(snapshot);
      })
      .catch(() => undefined);
    const unsubscribe = window.multiCliWork.usage.onChange(setUsage);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const refresh = useCallback(() => {
    void window.multiCliWork.usage.refresh().then(setUsage).catch(() => undefined);
  }, []);

  return { usage, refresh };
}
