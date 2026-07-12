import type { UpdaterStatus } from "@shared/api-types";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { updaterStatusLabel } from "./session-labels";

export function UpdateBadge() {
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState<UpdaterStatus>({ state: "idle" });

  useEffect(() => {
    void window.multiCliWork.updates.appVersion().then(setVersion).catch(() => undefined);
    // The first check starts before this component mounts, so read the current state instead of
    // waiting for an event that may already have fired.
    void window.multiCliWork.updates.status().then(setStatus).catch(() => undefined);
    return window.multiCliWork.updates.onEvent(setStatus);
  }, []);

  const downloaded = status.state === "downloaded";
  const busy = status.state === "checking" || status.state === "downloading";

  return (
    <div className="update-badge">
      <RefreshCw size={12} className={busy ? "spinning" : undefined} aria-hidden="true" />
      <span className="app-version">{version ? `v${version}` : ""}</span>
      <span className={`update-status ${status.state}`}>{updaterStatusLabel(status)}</span>
      {status.state === "error" ? (
        <button type="button" onClick={() => void window.multiCliWork.updates.openReleases()}>
          릴리스
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          title={downloaded ? "업데이트를 설치하려면 앱을 재시작하세요" : "업데이트 확인"}
          onClick={() =>
            void (downloaded ? window.multiCliWork.updates.install() : window.multiCliWork.updates.check())
          }
        >
          {downloaded ? "재시작" : "확인"}
        </button>
      )}
    </div>
  );
}
