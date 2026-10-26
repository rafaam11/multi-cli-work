import { useEffect } from "react";
import type { RemoteSessionSummary } from "@shared/remote-types";
import type { RemoteClient } from "./remote-client";
import type { ShellBridge } from "./shell-bridge";

/** Only an attached, exposed foreground terminal is a view; opening a notification alone is not. */
export function useSessionViewing(client: RemoteClient | null, bridge: ShellBridge | null, session: RemoteSessionSummary | null,
  ready: boolean, covered: boolean, capable: boolean) {
  const id = session?.id;
  const generation = session?.attention?.generation;
  const seenThrough = session?.attention?.seenThrough;
  useEffect(() => {
    let sent = false;
    const update = () => {
      const visible = ready && !covered && document.visibilityState === "visible" && document.hasFocus() && (bridge?.isForeground?.() ?? true);
      bridge?.viewingSession?.(visible && id ? id : "", visible ? generation ?? -1 : -1);
      if (visible && id && capable && generation !== undefined && (seenThrough ?? -1) < generation && !sent) {
        sent = client?.send({ type: "seen", sessionId: id, generation }) ?? false;
      }
    };
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    window.addEventListener("mcw-foreground", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      window.removeEventListener("mcw-foreground", update);
      bridge?.viewingSession?.("", -1);
    };
  }, [client, bridge, id, generation, seenThrough, ready, covered, capable]);
}
