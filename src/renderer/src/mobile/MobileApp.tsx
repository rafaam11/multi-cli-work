import { useEffect, useRef, useState } from "react";
import type { RemoteCatalog, RemoteSessionSummary } from "@shared/remote-types";
import { startSize, type MeasuredSize } from "./initial-size";
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
import { SessionTabs } from "./SessionTabs";
import { SessionDrawer } from "./SessionDrawer";
import { SessionContext } from "./SessionContext";
import { useSessionDrawer } from "./use-session-drawer";
import { useSessionViewing } from "./use-session-viewing";
import { sessionHash, sessionIdFromHash, useWideLayout } from "./wide-layout";

/** 이 앱이 세션 화면으로 쌓은 history 항목 표시. 이 항목에서 ←는 history.back()이다. */
const SESSION_ENTRY = { mcw: "session" } as const;

function isSessionEntry(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as { mcw?: unknown }).mcw === "session";
}

function listUrl(): string {
  return window.location.pathname + window.location.search;
}

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
  const [hostId, setHostId] = useState(window.location.origin);
  const [seenCapable, setSeenCapable] = useState(false);
  const [readySessionId, setReadySessionId] = useState<string | null>(null);
  const [openSessionId, setOpenSessionId] = useState<string | null>(() => sessionIdFromHash(window.location.hash));
  const wide = useWideLayout();
  /** 새 세션 폼이 열려 있는지와, 호스트가 알려 준 폴더·에이전트 목록. */
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [catalog, setCatalog] = useState<RemoteCatalog | null>(null);
  /** 호스트가 거절한 이유 — 이미 끝난 세션, 지울 수 없는 세션 같은 것. */
  const [refusal, setRefusal] = useState<string | null>(null);
  /** 세션 화면이 마지막으로 잰 터미널 크기. 새 세션을 이 화면에 맞는 크기로 띄우는 데 쓴다. */
  const measuredRef = useRef<MeasuredSize | null>(null);

  const openSessionIdRef = useRef(openSessionId);
  openSessionIdRef.current = openSessionId;
  const wideRef = useRef(wide);
  wideRef.current = wide;

  // 세션 화면은 history 항목 하나다 — Android 뒤로가기(WebView goBack)가 PC 목록이 아니라 세션 목록으로
  // 돌아오게. 링크(알림)로 바로 열었으면 목록 항목을 그 아래에 깔아 둔다.
  useEffect(() => {
    if (!sessionIdFromHash(window.location.hash) || isSessionEntry(window.history.state)) return;
    const sessionId = sessionIdFromHash(window.location.hash)!;
    window.history.replaceState(null, "", listUrl());
    window.history.pushState(SESSION_ENTRY, "", sessionHash(sessionId));
  }, []);

  useEffect(() => {
    const onPopState = () => setOpenSessionId(sessionIdFromHash(window.location.hash));
    // 셸이 열려 있는 창에 다른 세션을 가리키는 링크를 다시 로드하면 해시만 바뀌고, 브라우저가 새 항목을 만든다.
    const onHashChange = () => {
      const sessionId = sessionIdFromHash(window.location.hash);
      if (sessionId && window.history.state === null) window.history.replaceState(SESSION_ENTRY, "", window.location.hash);
      setOpenSessionId(sessionId);
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  /** 목록에서 열면 새 항목, 세션끼리 옮기면(탭) 지금 항목을 바꾼다. 넓은 화면은 목록이 늘 옆에 있어 바꾸기만 한다. */
  const showSession = (sessionId: string, from: "list" | "session") => {
    if (from === "list" && !wideRef.current) window.history.pushState(SESSION_ENTRY, "", sessionHash(sessionId));
    else window.history.replaceState(window.history.state, "", sessionHash(sessionId));
    setOpenSessionId(sessionId);
  };
  const showList = () => {
    if (isSessionEntry(window.history.state)) {
      window.history.back();
      return;
    }
    window.history.replaceState(window.history.state, "", listUrl());
    setOpenSessionId(null);
  };
  const showSessionRef = useRef(showSession);
  showSessionRef.current = showSession;

  const [client, setClient] = useState<RemoteClient | null>(null);
  const drawer = useSessionDrawer();
  const openSession = sessions.find((session) => session.id === openSessionId) ?? null;
  useSessionViewing(client, bridge, openSession, connection === "open" && readySessionId === openSessionId,
    drawer.isOpen, seenCapable);
  const mainRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mainRef.current) mainRef.current.inert = drawer.isOpen && !wide;
  }, [drawer.isOpen, wide]);
  useEffect(() => {
    if (wide && drawer.isOpen) drawer.close();
  }, [wide, drawer.isOpen, drawer.close]);

  // 클라이언트는 effect 안에서 만들고 cleanup에서 닫는다 — 닫힌 RemoteClient는 다시 connect하지
  // 않으므로, StrictMode의 이중 실행에서도 매번 새 인스턴스여야 한다.
  useEffect(() => {
    if (!pairing) return;
    const next = new RemoteClient({ url: remoteSocketUrl(window.location), token: pairing.token });
    const offMessage = next.onMessage((message) => {
      setSessions((current) => applySessionMessage(current, message));
      if (message.type === "welcome") { setHostId(message.hostId); setSeenCapable(message.capabilities?.includes("session-seen-v1") ?? false); }
      if (message.type === "catalog") setCatalog({ projects: message.projects, agents: message.agents });
      // 이 화면이 만들거나 다시 시작한 세션 — 바로 연다. 목록에는 created가 따로 실어 온다.
      else if (message.type === "started") {
        showSessionRef.current(message.sessionId, openSessionIdRef.current ? "session" : "list");
      }
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

  const openNewSessionForm = () => {
    // 폴더·에이전트는 열 때마다 다시 묻는다 — 호스트에서 그사이 바뀌었을 수 있다.
    setCatalog(null);
    setNewSessionOpen(true);
    client.send({ type: "catalog" });
  };
  const list = (
    <SessionList
      hostName={pairing.hostName}
      connection={connection}
      sessions={sessions}
      onOpen={(sessionId) => showSession(sessionId, "list")}
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
      onNewSession={openNewSessionForm}
    >
      {newSessionOpen ? (
        <NewSessionForm
          catalog={catalog}
          onStart={(projectId, kind, worktreeId) => {
            const size = startSize({
              measured: measuredRef.current,
              wide,
              viewport: { width: window.innerWidth, height: window.innerHeight },
            });
            client.send({ type: "create", projectId, kind, ...(worktreeId ? { worktreeId } : {}), ...size });
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
      onReady={ready => setReadySessionId(ready ? openSession.id : null)}
      onBack={showList}
      onMeasured={(size) => {
        measuredRef.current = { ...size, wide };
      }}
      tabs={
        wide ? undefined : (
          <SessionTabs
            sessions={sessions}
            activeSessionId={openSession.id}
            onSelect={(sessionId) => showSession(sessionId, "session")}
            onNewSession={() => {
              showList();
              openNewSessionForm();
            }}
          />
        )
      }
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
      <div className="m-phone-main" ref={mainRef}>
        {openSession && <SessionContext key={openSession.id} session={openSession} onOpen={drawer.open} />}
        <div className="m-phone-body">{screen ?? list}</div>
      </div>
      {drawer.isOpen && <SessionDrawer hostId={hostId} hostName={pairing.hostName} sessions={sessions} activeId={openSession?.id ?? null} onClose={() => drawer.close()} onSelect={id => drawer.close(() => showSession(id, openSession ? "session" : "list"))} />}
      {toast}
    </>
  );
}
