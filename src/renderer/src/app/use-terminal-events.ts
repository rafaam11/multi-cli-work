import type { TerminalSessionView } from "@shared/api-types";
import type { GitWorkspaceView, SharedWorktree } from "@shared/worktree-types";
import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { AgentView } from "@shared/agent-types";
import type { ActivityEntry } from "../HomeDashboard";
import { sessionLabel } from "../session-labels";
import { ACTIVITY_LOG_LIMIT, applyEvent, replaceSession } from "./app-model";

export interface TerminalEventTargets {
  setSessions: Dispatch<SetStateAction<TerminalSessionView[]>>;
  setFocusedPaneId: Dispatch<SetStateAction<string | null>>;
  setSelectedSessionId: Dispatch<SetStateAction<string | null>>;
  setWorkspaceViews: Dispatch<SetStateAction<GitWorkspaceView[]>>;
  setWorktreeWarnings: Dispatch<SetStateAction<Record<string, string>>>;
  setWorktrees: Dispatch<SetStateAction<SharedWorktree[]>>;
  setActivityLog: Dispatch<SetStateAction<ActivityEntry[]>>;
  /** 최신 세션 목록. 상태 변화의 이전 값을 읽는다. */
  sessionsRef: MutableRefObject<TerminalSessionView[]>;
  agentsRef: MutableRefObject<AgentView[]>;
}

/**
 * main이 보내는 터미널 이벤트로 세션 목록을 최신으로 유지한다. 이 창이 만들지 않은 세션(다른 패인의
 * 지연 재개, jk-coding-cli spawn, 원격 클라이언트)과 다른 곳에서의 삭제도 여기로 온다. 상태가 바뀌면
 * 홈의 활동 기록에 한 줄을 남긴다. 구독은 한 번만 하고, 넘겨받는 setter와 ref는 바뀌지 않는다.
 */
export function useTerminalEvents(targets: TerminalEventTargets): void {
  const {
    setSessions,
    setFocusedPaneId,
    setSelectedSessionId,
    setWorkspaceViews,
    setWorktreeWarnings,
    setWorktrees,
    setActivityLog,
    sessionsRef,
    agentsRef,
  } = targets;
  const activityIdRef = useRef(0);

  useEffect(
    () =>
      window.multiCliWork.terminals.onEvent((event) => {
        if (event.type === "data") return;
        // A session the renderer did not start itself — a lazy auto-resume in the other pane, a
        // jk-coding-cli spawn — still has to appear in the list.
        if (event.type === "created") {
          setSessions((current) => replaceSession(current, event.session));
          return;
        }
        // Removed by someone else — a remote client, a folder teardown. A removal this window asked
        // for arrives here too; `removeSessionById` then picks the next selection on top of this.
        if (event.type === "removed") {
          setSessions((current) => current.filter((session) => session.id !== event.sessionId));
          setFocusedPaneId((current) => (current === event.sessionId ? null : current));
          setSelectedSessionId((current) => (current === event.sessionId ? null : current));
          return;
        }
        if (event.type === "workspace") {
          setSessions((current) => replaceSession(current, event.session));
          // Keep the live pane in place. Its sidebar row and next folder selection use the new
          // binding; moving/unmounting the active grid would interrupt an in-progress interaction.
          void window.multiCliWork.worktrees.sync().then((next) => {
            setWorkspaceViews(next.workspaces);
            setWorktreeWarnings(next.warnings);
            return window.multiCliWork.worktrees.list();
          }).then(setWorktrees).catch(() => undefined);
          return;
        }
        if (event.type === "agent-edits") {
          // No path is in the event (renderer never sees absolute paths) and no session field
          // changes — just tell FileExplorer to re-pull changedPaths for whatever target is open,
          // same as GitPanel's mcw:git-refresh.
          window.dispatchEvent(new Event("mcw:agent-edits"));
          return;
        }
        if (event.type === "status") {
          const previous = sessionsRef.current.find((session) => session.id === event.sessionId);
          if (previous && previous.status !== event.status) {
            const peers = sessionsRef.current.filter((session) => session.projectId === previous.projectId);
            setActivityLog((log) =>
              [
                {
                  id: `activity-${activityIdRef.current++}`,
                  timestamp: new Date().toISOString(),
                  projectId: previous.projectId,
                  sessionId: previous.id,
                  sessionLabel: sessionLabel(previous, peers, agentsRef.current),
                  fromStatus: previous.status,
                  toStatus: event.status,
                },
                ...log,
              ].slice(0, ACTIVITY_LOG_LIMIT),
            );
          }
        }
        setSessions((current) =>
          current.map((session) => (session.id === event.sessionId ? applyEvent(session, event) : session)),
        );
      }),
    [],
  );
}
