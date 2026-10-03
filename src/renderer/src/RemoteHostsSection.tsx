import type { RemoteHostLink, RemoteHostView } from "@shared/remote-types";
import { Monitor } from "lucide-react";
import { useEffect, useState } from "react";
import { errorMessage } from "./ipc-error";

/** 상태 연결이 지금 어떤지. off는 연결이 없다는 뜻(다시 페어링해야 하는 호스트)이라 점을 그리지 않는다. */
const LINK_LABEL: Record<RemoteHostLink, string | null> = {
  off: null,
  connecting: "연결 중",
  open: "연결됨",
  reconnecting: "연결 끊김",
  incompatible: "버전이 맞지 않음",
};

/**
 * 사이드바의 "원격 PC". 등록해 둔 다른 PC를 누르면 그 PC의 세션 화면이 별도 창으로 열린다. 등록은
 * 설정 ▸ 원격에서 한다 — 하나도 없으면 이 섹션은 그려지지 않는다.
 */
export function RemoteHostsSection({ onOpenSettings }: { onOpenSettings(): void }) {
  const [hosts, setHosts] = useState<RemoteHostView[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** 창이 뜰 때까지 — 응답 없는 호스트는 몇 초가 걸린다. */
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    void window.multiCliWork.remoteHosts.list().then(setHosts).catch(() => undefined);
    return window.multiCliWork.remoteHosts.onChanged(setHosts);
  }, []);

  if (hosts.length === 0) return null;

  const open = (host: RemoteHostView) => {
    if (!host.paired) {
      onOpenSettings();
      return;
    }
    setError(null);
    setOpeningId(host.hostId);
    window.multiCliWork.remoteHosts
      .open(host.hostId)
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setOpeningId((current) => (current === host.hostId ? null : current)));
  };

  return (
    <section className="remote-hosts" aria-label="원격 PC">
      <h2>원격 PC</h2>
      {hosts.map((host) => (
        <button
          type="button"
          className="remote-host"
          key={host.hostId}
          title={host.address}
          disabled={openingId === host.hostId}
          onClick={() => open(host)}
        >
          <Monitor size={13} aria-hidden="true" />
          {LINK_LABEL[host.link] ? (
            <span className={`remote-host-link remote-host-link-${host.link}`} role="img" aria-label={LINK_LABEL[host.link] ?? undefined} />
          ) : null}
          <span className="remote-host-name">{host.name}</span>
          {host.awaiting > 0 ? (
            <span className="remote-host-count" aria-label={`대기 중인 세션 ${host.awaiting}개`}>
              {host.awaiting}
            </span>
          ) : null}
          {host.paired ? null : <span className="remote-host-note">다시 페어링 필요</span>}
          {openingId === host.hostId ? <span className="remote-host-note">여는 중…</span> : null}
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
