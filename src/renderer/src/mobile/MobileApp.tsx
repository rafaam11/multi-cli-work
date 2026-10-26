import { useEffect, useRef, useState } from "react";
import type { RemoteCatalog, RemoteMirror, RemoteSessionSummary, RemoteViewAction } from "@shared/remote-types";
import { startSize, type MeasuredSize } from "./initial-size";
import { NewSessionForm } from "./NewSessionForm";
import { MirrorGrid } from "./MirrorGrid";
import { closePane, gridColumns, loadPanes, placePane, savePanes } from "./pane-grid";
import { PairScreen } from "./PairScreen";
import { ProjectTree } from "./ProjectTree";
import {
  clearPairing,
  loadPairing,
  RemoteClient,
  remoteSocketUrl,
  savePairing,
  type RemoteClientState,
  type StoredPairing,
} from "./remote-client";
import { SHELF_TEXT } from "../shelves";
import { SessionList } from "./SessionList";
import { SessionScreen } from "./SessionScreen";
import { applySessionMessage } from "./session-list-model";
import { setHostTheme } from "./color-scheme";
import { readShellBridge } from "./shell-bridge";
import { SessionTabs } from "./SessionTabs";
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

/** 미러 도구줄에 쓰는 호스트가 보는 곳의 이름. */
function mirrorPlaceLabel(mirror: RemoteMirror): string {
  const place = mirror.view.place;
  if (place.kind === "shelf") return SHELF_TEXT[place.shelf].name;
  if (place.kind === "other") return "호스트 화면";
  const folder = mirror.tree.flatMap((section) => section.folders).find((item) => item.id === place.projectId);
  if (!folder) return "호스트 화면";
  if (place.worktreeId === null) return folder.name;
  const worktree = folder.worktrees.find((item) => item.id === place.worktreeId);
  return worktree ? `${folder.name} · ${worktree.branch}` : folder.name;
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
  /** 트리의 "+"로 열면 그 폴더·worktree가 골라진 채로 연다. */
  const [newSessionInitial, setNewSessionInitial] = useState<{ projectId: string; worktreeId: string | null } | null>(null);
  // 목록에서 세션을 누를 때마다 늘린다 — 호스트 포커스가 이미 그 칸이어도 키보드가 터미널로 가게.
  const [mirrorFocusRequest, setMirrorFocusRequest] = useState(0);
  const [catalog, setCatalog] = useState<RemoteCatalog | null>(null);
  /** 호스트가 거절한 이유 — 이미 끝난 세션, 지울 수 없는 세션 같은 것. */
  const [refusal, setRefusal] = useState<string | null>(null);
  /** 세션 화면이 마지막으로 잰 터미널 크기. 새 세션을 이 화면에 맞는 크기로 띄우는 데 쓴다. */
  const measuredRef = useRef<MeasuredSize | null>(null);
  /** 호스트 메인 창의 트리와 그리드. null이면 호스트 창이 없거나 구버전이라 이 화면이 자기 그리드를 쓴다. */
  const [mirror, setMirror] = useState<RemoteMirror | null>(null);

  /**
   * 넓은 화면 그리드에 떠 있는 세션들. 포커스(키보드) 칸은 `openSessionId`이고, 해시도 그것만 따른다.
   * 칸은 페어링마다 따로 저장하므로 어느 페어링의 칸인지(`owner`)를 함께 둔다.
   */
  const deviceId = pairing?.deviceId ?? null;
  const [paneState, setPaneState] = useState(() => ({
    owner: deviceId,
    ids: deviceId ? loadPanes(storage(), deviceId) : [],
  }));
  if (paneState.owner !== deviceId) setPaneState({ owner: deviceId, ids: deviceId ? loadPanes(storage(), deviceId) : [] });
  const panes = paneState.owner === deviceId ? paneState.ids : [];
  const setPanes = (update: (current: string[]) => string[]) =>
    setPaneState((state) => ({ owner: state.owner, ids: update(state.ids) }));
  useEffect(() => {
    if (paneState.owner) savePanes(storage(), paneState.owner, paneState.ids);
  }, [paneState]);

  const openSessionIdRef = useRef(openSessionId);
  openSessionIdRef.current = openSessionId;
  const wideRef = useRef(wide);
  wideRef.current = wide;
  /** 넓은 화면이 호스트 그리드를 따라 그리는 중인지. 그때는 칸을 이 화면이 놓지 않고 호스트에 요청한다. */
  const mirroring = wide && mirror !== null;
  const mirroringRef = useRef(mirroring);
  mirroringRef.current = mirroring;

  // 호스트 창과 같은 테마로 — 호스트가 알려 주지 않으면 이 기기 설정을 따른다.
  const hostTheme = mirror?.theme ?? null;
  useEffect(() => setHostTheme(hostTheme), [hostTheme]);

  // 포커스로 온 세션이 칸에 없으면 놓는다 — 목록·링크·새 세션 어디서 왔든. 가득 찼으면 직전 포커스 칸을 바꾼다.
  const previousFocusRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousFocusRef.current;
    if (wide && openSessionId && !mirroringRef.current) {
      setPanes((current) => (current.includes(openSessionId) ? current : placePane(current, previous, openSessionId)));
    }
    previousFocusRef.current = openSessionId;
  }, [wide, openSessionId]);

  // 호스트 그리드를 따라 그릴 때 포커스·해시는 호스트의 포커스 칸을 따른다. 문서 칸이면 그대로 둔다.
  const mirrorFocusId =
    mirror?.view.slots.find((slot) => slot?.kind === "session" && slot.id === mirror.view.focusedPaneId)?.id ?? null;
  useEffect(() => {
    if (!mirroring || !mirrorFocusId || mirrorFocusId === openSessionIdRef.current) return;
    window.history.replaceState(window.history.state, "", sessionHash(mirrorFocusId));
    setOpenSessionId(mirrorFocusId);
  }, [mirroring, mirrorFocusId]);

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

  // 클라이언트는 effect 안에서 만들고 cleanup에서 닫는다 — 닫힌 RemoteClient는 다시 connect하지
  // 않으므로, StrictMode의 이중 실행에서도 매번 새 인스턴스여야 한다.
  useEffect(() => {
    if (!pairing) return;
    const next = new RemoteClient({ url: remoteSocketUrl(window.location), token: pairing.token });
    const offMessage = next.onMessage((message) => {
      setSessions((current) => applySessionMessage(current, message));
      if (message.type === "removed") setPanes((current) => current.filter((id) => id !== message.sessionId));
      if (message.type === "catalog") setCatalog({ projects: message.projects, agents: message.agents });
      // 이 화면이 만들거나 다시 시작한 세션 — 바로 연다. 목록에는 created가 따로 실어 온다.
      // 호스트 그리드를 따라 그리는 중이면 호스트 그리드에 연다 — 포커스가 돌아오며 이 화면도 따른다.
      else if (message.type === "started") {
        if (mirroringRef.current) next.send({ type: "view", action: "open", sessionId: message.sessionId });
        else showSessionRef.current(message.sessionId, openSessionIdRef.current ? "session" : "list");
      } else if (message.type === "mirror") setMirror(message.mirror);
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
      setMirror(null);
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

  // 이름은 호스트 메인 창과 같게 — 같은 폴더의 세션이 여럿이면 "PowerShell 1"·"PowerShell 2".
  const labels = mirror?.labels;
  const named = labels
    ? sessions.map((session) => {
        const label = labels[session.id];
        return label && label !== session.label ? { ...session, label } : session;
      })
    : sessions;
  const openSession = named.find((session) => session.id === openSessionId) ?? null;
  const openNewSessionForm = (initial: { projectId: string; worktreeId: string | null } | null = null) => {
    // 폴더·에이전트는 열 때마다 다시 묻는다 — 호스트에서 그사이 바뀌었을 수 있다.
    setCatalog(null);
    setNewSessionInitial(initial);
    setNewSessionOpen(true);
    client.send({ type: "catalog" });
  };
  const gridSessions = panes
    .map((id) => named.find((session) => session.id === id))
    .filter((session): session is RemoteSessionSummary => session !== undefined);
  const closeGridPane = (sessionId: string) => {
    const next = closePane(panes, openSessionId, sessionId);
    setPanes(() => next.panes);
    if (next.focusedId === openSessionId) return;
    window.history.replaceState(window.history.state, "", next.focusedId ? sessionHash(next.focusedId) : listUrl());
    setOpenSessionId(next.focusedId);
  };
  const sendView = (action: RemoteViewAction) => client.send({ type: "view", ...action });
  const rename = (sessionId: string) => (name: string) => client.send({ type: "rename", sessionId, name });
  const mirrorSessionIds = mirror
    ? mirror.view.slots.flatMap((slot) => (slot?.kind === "session" ? [slot.id] : []))
    : [];
  /** 목록·트리에서 세션을 누르면: 호스트 그리드를 따르면 호스트에 열고, 아니면 이 화면에 연다. */
  const openFromList = (sessionId: string) => {
    if (mirroring) {
      sendView({ action: "open", sessionId });
      setMirrorFocusRequest((count) => count + 1);
    } else showSession(sessionId, "list");
  };
  const disabled = connection !== "open";
  const tree = mirror ? (
    <ProjectTree
      tree={mirror.tree}
      sessions={named}
      place={mirror.view.place}
      onScreenSessionIds={wide ? mirrorSessionIds : []}
      disabled={disabled}
      onSelectFolder={
        mirroring ? (projectId, worktreeId) => sendView({ action: "select-folder", projectId, worktreeId }) : undefined
      }
      onNewSession={(projectId, worktreeId) => openNewSessionForm({ projectId, worktreeId })}
      onOpenSession={openFromList}
    />
  ) : null;
  const list = (
    <SessionList
      hostName={pairing.hostName}
      connection={connection}
      sessions={named}
      onOpen={openFromList}
      activeSessionId={wide ? (mirroring ? mirrorFocusId : (openSession?.id ?? null)) : null}
      onScreenSessionIds={wide ? (mirroring ? mirrorSessionIds : gridSessions.map((session) => session.id)) : []}
      onMoveShelf={(sessionId, shelf) => client.send({ type: "shelf", sessionId, shelf })}
      leaveLabel={bridge ? "호스트 목록" : "연결 해제"}
      onUnpair={() => {
        if (bridge) {
          bridge.backToHosts();
          return;
        }
        clearPairing(storage());
        setPairing(null);
      }}
      onNewSession={() => openNewSessionForm()}
      footer={tree}
    >
      {newSessionOpen ? (
        <NewSessionForm
          key={newSessionInitial ? `${newSessionInitial.projectId}:${newSessionInitial.worktreeId ?? ""}` : "blank"}
          catalog={catalog}
          initial={newSessionInitial}
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
  const measured = (size: { cols: number; rows: number }) => {
    measuredRef.current = { ...size, wide };
  };
  const screen = openSession ? (
    <SessionScreen
      key={openSession.id}
      client={client}
      session={openSession}
      deviceId={pairing.deviceId}
      wide={wide}
      onBack={showList}
      onMeasured={measured}
      onRename={rename(openSession.id)}
      tabs={
        wide ? undefined : (
          <SessionTabs
            sessions={named}
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

  if (mirroring && mirror) {
    return (
      <>
        <div className="m-wide">
          {list}
          <MirrorGrid
            view={mirror.view}
            placeLabel={mirrorPlaceLabel(mirror)}
            sessions={named}
            disabled={disabled}
            onView={sendView}
            onNewSession={() => {
              const place = mirror.view.place;
              openNewSessionForm(place.kind === "folder" ? { projectId: place.projectId, worktreeId: place.worktreeId } : null);
            }}
            renderPane={(pane) => (
              <SessionScreen
                key={pane.session.id}
                client={client}
                session={pane.session}
                deviceId={pairing.deviceId}
                wide
                fitOnlyWhenFocused
                focused={pane.focused}
                onBack={showList}
                onMeasured={pane.focused ? measured : undefined}
                onFocus={pane.onFocus}
                onClose={pane.onClose}
                zoomed={pane.zoomed}
                onToggleZoom={pane.onToggleZoom}
                paneActions={pane.actions}
                onHeaderDragStart={pane.onDragStart}
                onRename={rename(pane.session.id)}
                focusRequest={mirrorFocusRequest}
              />
            )}
          />
        </div>
        {toast}
      </>
    );
  }
  if (wide) {
    return (
      <>
        <div className="m-wide">
          {list}
          {gridSessions.length > 0 ? (
            <div
              className="m-grid"
              data-count={gridSessions.length}
              style={{ gridTemplateColumns: `repeat(${gridColumns(gridSessions.length)}, minmax(0, 1fr))` }}
            >
              {gridSessions.map((session) => {
                const focused = session.id === openSession?.id;
                return (
                  <SessionScreen
                    key={session.id}
                    client={client}
                    session={session}
                    deviceId={pairing.deviceId}
                    wide
                    focused={focused}
                    onBack={showList}
                    onMeasured={focused ? measured : undefined}
                    onFocus={() => showSession(session.id, "session")}
                    onClose={() => closeGridPane(session.id)}
                    onRename={rename(session.id)}
                  />
                );
              })}
            </div>
          ) : (
            <p className="m-empty m-wide-placeholder">왼쪽에서 세션을 고르세요</p>
          )}
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
