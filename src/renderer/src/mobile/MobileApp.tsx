import { useEffect, useState } from "react";
import type { RemoteCatalog, RemoteSessionSummary } from "@shared/remote-types";
import { NewSessionForm } from "./NewSessionForm";
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
import { readShellBridge } from "./shell-bridge";
import { sessionIdFromHash, useWideLayout } from "./wide-layout";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function MobileApp() {
  const [bridge] = useState(() => readShellBridge(window as unknown as { McwShell?: unknown }));
  const [pairing, setPairing] = useState<StoredPairing | null>(() => bridge?.pairing ?? loadPairing(storage()));
  const [notice, setNotice] = useState<string | null>(null);
  const [connection, setConnection] = useState<RemoteClientState>("connecting");
  const [sessions, setSessions] = useState<RemoteSessionSummary[]>([]);
  const [openSessionId, setOpenSessionId] = useState<string | null>(() => sessionIdFromHash(window.location.hash));
  const wide = useWideLayout();
  /** 새 세션 폼이 열려 있는지와, 호스트가 알려 준 폴더·에이전트 목록. */
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [catalog, setCatalog] = useState<RemoteCatalog | null>(null);
  /** 호스트가 거절한 이유 — 이미 끝난 세션, 지울 수 없는 세션 같은 것. */
  const [refusal, setRefusal] = useState<string | null>(null);

  // 셸이 열려 있는 창에 다른 세션을 가리키는 링크를 다시 로드하면 해시만 바뀐다.
  useEffect(() => {
    const onHashChange = () => {
      const sessionId = sessionIdFromHash(window.location.hash);
      if (sessionId) setOpenSessionId(sessionId);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const [client, setClient] = useState<RemoteClient | null>(null);

  // 클라이언트는 effect 안에서 만들고 cleanup에서 닫는다 — 닫힌 RemoteClient는 다시 connect하지
  // 않으므로, StrictMode의 이중 실행에서도 매번 새 인스턴스여야 한다.
  useEffect(() => {
    if (!pairing) return;
    const next = new RemoteClient({ url: remoteSocketUrl(window.location), token: pairing.token });
    const offMessage = next.onMessage((message) => {
      setSessions((current) => applySessionMessage(current, message));
      if (message.type === "catalog") setCatalog({ projects: message.projects, agents: message.agents });
      // 이 화면이 만들거나 다시 시작한 세션 — 바로 연다. 목록에는 created가 따로 실어 온다.
      else if (message.type === "started") setOpenSessionId(message.sessionId);
      // 인증·버전 오류는 연결이 끊기며 따로 처리된다. 여기서는 요청이 거절된 이유만 보인다.
      else if (message.type === "error" && message.code !== "unauthorized" && message.code !== "protocol") {
        setRefusal(message.message);
      }
    });
    const offState = next.onState((state) => {
      setConnection(state);
      if (state === "unauthorized") {
        if (bridge) {
          bridge.unpaired();
          return;
        }
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
  }, [pairing, bridge]);

  if (bridge && !pairing) {
    return <p className="m-banner">셸에 이 PC의 페어링 정보가 없습니다. 호스트 목록에서 다시 추가하세요.</p>;
  }
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
  const list = (
    <SessionList
      hostName={pairing.hostName}
      connection={connection}
      sessions={sessions}
      onOpen={setOpenSessionId}
      activeSessionId={wide ? (openSession?.id ?? null) : null}
      leaveLabel={bridge ? "호스트 목록" : "연결 해제"}
      onUnpair={() => {
        if (bridge) {
          bridge.backToHosts();
          return;
        }
        clearPairing(storage());
        setPairing(null);
      }}
      onNewSession={() => {
        // 폴더·에이전트는 열 때마다 다시 묻는다 — 호스트에서 그사이 바뀌었을 수 있다.
        setCatalog(null);
        setNewSessionOpen(true);
        client.send({ type: "catalog" });
      }}
    >
      {newSessionOpen ? (
        <NewSessionForm
          catalog={catalog}
          onStart={(projectId, kind) => {
            client.send({ type: "create", projectId, kind });
            setNewSessionOpen(false);
          }}
          onCancel={() => setNewSessionOpen(false)}
        />
      ) : null}
    </SessionList>
  );
  const toast = refusal ? (
    <p className="m-toast" role="alert">
      <span>{refusal}</span>
      <button type="button" onClick={() => setRefusal(null)}>
        닫기
      </button>
    </p>
  ) : null;
  const screen = openSession ? (
    <SessionScreen
      key={openSession.id}
      client={client}
      session={openSession}
      deviceId={pairing.deviceId}
      wide={wide}
      onBack={() => setOpenSessionId(null)}
    />
  ) : null;

  if (wide) {
    return (
      <>
        <div className="m-wide">
          {list}
          {screen ?? <p className="m-empty m-wide-placeholder">왼쪽에서 세션을 고르세요</p>}
        </div>
        {toast}
      </>
    );
  }
  return (
    <>
      {screen ?? list}
      {toast}
    </>
  );
}
