import { useEffect, useState } from "react";
import type { RemoteSessionSummary } from "@shared/remote-types";
import { PairScreen } from "./PairScreen";
import {
  clearPairing,
  loadPairing,
  RemoteClient,
  remoteSocketUrl,
  savePairing,
  type RemoteClientState,
  type StoredPairing,
} from "./remote-client";
import { SessionList } from "./SessionList";
import { SessionScreen } from "./SessionScreen";
import { applySessionMessage } from "./session-list-model";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function MobileApp() {
  const [pairing, setPairing] = useState<StoredPairing | null>(() => loadPairing(storage()));
  const [notice, setNotice] = useState<string | null>(null);
  const [connection, setConnection] = useState<RemoteClientState>("connecting");
  const [sessions, setSessions] = useState<RemoteSessionSummary[]>([]);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);

  const [client, setClient] = useState<RemoteClient | null>(null);

  // 클라이언트는 effect 안에서 만들고 cleanup에서 닫는다 — 닫힌 RemoteClient는 다시 connect하지
  // 않으므로, StrictMode의 이중 실행에서도 매번 새 인스턴스여야 한다.
  useEffect(() => {
    if (!pairing) return;
    const next = new RemoteClient({ url: remoteSocketUrl(window.location), token: pairing.token });
    const offMessage = next.onMessage((message) => setSessions((current) => applySessionMessage(current, message)));
    const offState = next.onState((state) => {
      setConnection(state);
      if (state === "unauthorized") {
        clearPairing(storage());
        setNotice("이 기기의 연결이 해제되었습니다. 다시 페어링하세요.");
        setPairing(null);
      }
    });
    next.connect();
    setClient(next);
    return () => {
      offMessage();
      offState();
      next.close();
      setClient(null);
    };
  }, [pairing]);

  if (pairing && !client) return <p className="m-banner">연결 중…</p>;
  if (!pairing || !client) {
    return (
      <PairScreen
        notice={notice}
        onPaired={(next) => {
          savePairing(storage(), next);
          setNotice(null);
          setPairing(next);
        }}
      />
    );
  }

  const openSession = sessions.find((session) => session.id === openSessionId) ?? null;
  if (openSession) {
    return (
      <SessionScreen client={client} session={openSession} deviceId={pairing.deviceId} onBack={() => setOpenSessionId(null)} />
    );
  }
  return (
    <SessionList
      hostName={pairing.hostName}
      connection={connection}
      sessions={sessions}
      onOpen={setOpenSessionId}
      onUnpair={() => {
        clearPairing(storage());
        setPairing(null);
      }}
    />
  );
}
