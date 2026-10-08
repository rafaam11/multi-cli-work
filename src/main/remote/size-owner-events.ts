import type { TerminalSizeOwner } from "../../shared/api-types";
import { DESKTOP_SIZE_OWNER } from "../../shared/remote-types";
import type { TerminalSizeArbiter } from "./size-arbiter";

/** 기기 목록에서 이름을 못 찾았을 때(그사이 해제됐다) 부르는 이름. */
export const UNKNOWN_DEVICE_NAME = "다른 기기";

/**
 * 세션의 크기 주인이 바뀔 때만 데스크톱 화면에 알린다. 데스크톱이 패인 크기를 바꿀 때마다 오는
 * 변경은 주인이 그대로라 보내지 않는다. 데스크톱이 되찾으면 deviceName이 null이다.
 */
export function watchSizeOwners(options: {
  sizes: Pick<TerminalSizeArbiter, "onChange">;
  deviceName(deviceId: string): Promise<string | null>;
  send(owner: TerminalSizeOwner): void;
}): () => void {
  const owners = new Map<string, string>();
  return options.sizes.onChange((sessionId, state) => {
    const previous = owners.get(sessionId) ?? DESKTOP_SIZE_OWNER;
    if (previous === state.owner) return;
    if (state.owner === DESKTOP_SIZE_OWNER) owners.delete(sessionId);
    else owners.set(sessionId, state.owner);
    if (state.owner === DESKTOP_SIZE_OWNER) {
      options.send({ sessionId, deviceName: null });
      return;
    }
    const owner = state.owner;
    void options
      .deviceName(owner)
      .catch(() => null)
      .then((name) => {
        // 이름을 찾는 사이 주인이 또 바뀌었으면 늦은 소식은 버린다.
        if (owners.get(sessionId) === owner) options.send({ sessionId, deviceName: name ?? UNKNOWN_DEVICE_NAME });
      });
  });
}
