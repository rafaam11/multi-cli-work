import type { UpdaterStatus } from "@shared/api-types";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

function statusLabel(status: UpdaterStatus): string {
  switch (status.state) {
    case "checking":
      return "Checking for updates";
    case "available":
      return `Update ${status.version} available`;
    case "downloading":
      return `Downloading ${status.percent}%`;
    case "downloaded":
      return `Update ${status.version} ready`;
    case "error":
      return "Update check failed";
    default:
      return "Up to date";
  }
}

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
      <span className={`update-status ${status.state}`}>{statusLabel(status)}</span>
      {status.state === "error" ? (
        <button type="button" onClick={() => void window.multiCliWork.updates.openReleases()}>
          Releases
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          title={downloaded ? "Restart the app to install the update" : "Check for updates"}
          onClick={() =>
            void (downloaded ? window.multiCliWork.updates.install() : window.multiCliWork.updates.check())
          }
        >
          {downloaded ? "Restart" : "Check"}
        </button>
      )}
    </div>
  );
}
