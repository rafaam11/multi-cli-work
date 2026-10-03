import type { RemoteHostInfo } from "@shared/remote-types";
import { Monitor } from "lucide-react";
import { useEffect, useState } from "react";
import { errorMessage } from "./ipc-error";

/**
 * 사이드바의 "원격 PC". 등록해 둔 다른 PC를 누르면 그 PC의 세션 화면이 별도 창으로 열린다. 등록은
 * 설정 ▸ 원격에서 한다 — 하나도 없으면 이 섹션은 그려지지 않는다.
 */
export function RemoteHostsSection({ onOpenSettings }: { onOpenSettings(): void }) {
  const [hosts, setHosts] = useState<RemoteHostInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.multiCliWork.remoteHosts.list().then(setHosts).catch(() => undefined);
    return window.multiCliWork.remoteHosts.onChanged(setHosts);
  }, []);

  if (hosts.length === 0) return null;

  const open = (host: RemoteHostInfo) => {
    if (!host.paired) {
      onOpenSettings();
      return;
    }
    setError(null);
    window.multiCliWork.remoteHosts.open(host.hostId).catch((cause: unknown) => setError(errorMessage(cause)));
  };

  return (
    <section className="remote-hosts" aria-label="원격 PC">
      <h2>원격 PC</h2>
      {hosts.map((host) => (
        <button type="button" className="remote-host" key={host.hostId} title={host.address} onClick={() => open(host)}>
          <Monitor size={13} aria-hidden="true" />
          <span className="remote-host-name">{host.name}</span>
          {host.paired ? null : <span className="remote-host-note">다시 페어링 필요</span>}
        </button>
      ))}
      {error ? (
        <p className="remote-host-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
