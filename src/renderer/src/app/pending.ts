import type { Dispatch, SetStateAction } from "react";
import { errorMessage } from "../ipc-error";

/**
 * 한 번에 하나만 도는 작업의 틀: 진행 중 표시를 켜고(그동안 다른 작업 버튼이 막힌다), 실패하면 그
 * 이유를 화면 위 오류 줄에 보이고, 끝나면 표시를 끈다.
 */
export function pendingRunner(
  setPendingAction: Dispatch<SetStateAction<boolean>>,
  setActionError: Dispatch<SetStateAction<string | null>>,
) {
  return async (action: () => Promise<void>) => {
    setPendingAction(true);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setPendingAction(false);
    }
  };
}
