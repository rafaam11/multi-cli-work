import type { AgentId, AgentView } from "@shared/agent-types";
import type { SessionAttention, TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { TerminalStatus } from "@shared/terminal-types";
import type { SharedWorktree } from "@shared/worktree-types";
import type { DocumentKind, DocumentPane } from "./pane-items";
import { projectName, sessionLabel } from "./session-labels";

/**
 * 세션 패널의 한 줄. 트리에서 세션 행이 나온 뒤(설계 문서 참고) 사이드바가 "무엇이 나를 기다리나"를
 * 답하는 곳이다. App이 여기서 만든 정렬된 목록을 넘기고 패널은 그리기만 한다 — `shelfPaneRows`와
 * 같은 이유로, 어느 id가 무엇인지는 App만 안다.
 */
export type SessionScope = "all" | "here";

/** "여기"가 가리키는 곳. 홈·셸프·채널에는 페이지가 없으므로 none이고 토글은 비활성이다. */
export type SessionScopeTarget =
  | { kind: "none" }
  | { kind: "worktree"; worktreeId: string; label: string }
  | { kind: "folders"; projectIds: readonly string[]; label: string };

interface SessionPanelItemBase {
  /** 패인 id — 세션 id 또는 문서 id. 드래그 페이로드가 그대로 이 값이다. */
  id: string;
  label: string;
  /** 폴더명, 도구 세션이면 "도구", 소속을 모르면 null. */
  place: string | null;
  /** worktree 세션(문서)이면 브랜치, 아니면 null. */
  branch: string | null;
  projectId: string | null;
  worktreeId: string | null;
  rank: number;
}

export type SessionPanelItem =
  | (SessionPanelItemBase & {
      kind: "session";
      session: TerminalSessionView;
      status: TerminalStatus;
      agent: AgentId;
      tool: boolean;
      attention: SessionAttention | null;
    })
  | (SessionPanelItemBase & { kind: "document"; pane: DocumentPane; document: DocumentKind; dirty: boolean });

const STATUS_RANK: Record<TerminalStatus, number> = {
  "awaiting-approval": 0,
  "awaiting-input": 1,
  working: 2,
  starting: 2,
  idle: 3,
  exited: 3,
  error: 3,
};
const ATTENTION_RANK: Record<SessionAttention, number> = { approval: 0, input: 1 };
/** 문서는 언제나 세션 뒤다 — 기다리는 것이 없으니까. */
const DOCUMENT_RANK = 5;
/** 등급이 이 값 이하면 "대기 중"으로 센다 — approval(0)·input(1). */
const WAITING_RANK_MAX = 1;

/** 화면 밖에서 시작된 대기는 상태가 이미 지나갔을 수 있으므로 둘 중 급한 쪽을 쓴다. */
export function sessionRank(status: TerminalStatus, attention: SessionAttention | null): number {
  const fromStatus = STATUS_RANK[status];
  return attention ? Math.min(fromStatus, ATTENTION_RANK[attention]) : fromStatus;
}

type SessionPanelSessionItem = Extract<SessionPanelItem, { kind: "session" }>;

export function buildSessionPanelItems(input: {
  sessions: readonly TerminalSessionView[];
  documentPanes: readonly DocumentPane[];
  projects: readonly SharedProject[];
  worktrees: readonly SharedWorktree[];
  agents: readonly AgentView[];
  unread: Record<string, SessionAttention>;
}): SessionPanelItem[] {
  const nameById = new Map(input.projects.map((project) => [project.id, projectName(project)]));
  const worktreeById = new Map(input.worktrees.map((worktree) => [worktree.id, worktree]));
  const placeOf = (projectId: string | null) => (projectId === null ? "도구" : (nameById.get(projectId) ?? null));

  // 세션 하나당 전체 목록을 훑는 대신 projectId별로 한 번만 묶어 둔다 — 결과는 동일하다.
  const sessionsByProjectId = new Map<string | null, TerminalSessionView[]>();
  for (const session of input.sessions) {
    const bucket = sessionsByProjectId.get(session.projectId);
    if (bucket) bucket.push(session);
    else sessionsByProjectId.set(session.projectId, [session]);
  }

  const sessions = input.sessions
    .map<SessionPanelSessionItem>((session) => {
      const peers = sessionsByProjectId.get(session.projectId) ?? [session];
      const attention = input.unread[session.id] ?? null;
      const worktree = session.worktreeId ? worktreeById.get(session.worktreeId) : undefined;
      return {
        kind: "session",
        id: session.id,
        session,
        label: sessionLabel(session, peers, input.agents),
        place: placeOf(session.projectId),
        branch: worktree?.branch ?? null,
        projectId: session.projectId,
        worktreeId: session.worktreeId ?? null,
        status: session.status,
        agent: session.kind,
        tool: session.tool !== null,
        attention,
        rank: sessionRank(session.status, attention),
      };
    })
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        right.session.updatedAt.localeCompare(left.session.updatedAt) ||
        left.id.localeCompare(right.id),
    );

  const documents = input.documentPanes.map<SessionPanelItem>((pane) => {
    const owner = pane.owner;
    const worktree = owner?.kind === "worktree" ? worktreeById.get(owner.id) : undefined;
    const projectId = owner?.kind === "project" ? owner.id : (worktree?.projectId ?? null);
    return {
      kind: "document",
      id: pane.id,
      pane,
      label: pane.label,
      place: projectId === null ? null : (nameById.get(projectId) ?? null),
      branch: worktree?.branch ?? null,
      projectId,
      worktreeId: worktree?.id ?? null,
      document: pane.kind,
      dirty: pane.dirty,
      rank: DOCUMENT_RANK,
    };
  });

  return [...sessions, ...documents];
}

export function matchesScope(item: SessionPanelItem, target: SessionScopeTarget): boolean {
  switch (target.kind) {
    case "none":
      return true;
    case "worktree":
      return item.worktreeId === target.worktreeId;
    case "folders":
      // 폴더 배지가 worktree 세션을 세는 것과 같은 정의: 폴더는 자기 worktree까지 품는다.
      return item.projectId !== null && target.projectIds.includes(item.projectId);
  }
}

/** 등급 0·1(승인·입력 대기) 세션의 수 — 패널 헤더의 `대기 N`. */
export function sessionPanelWaitCount(items: readonly SessionPanelItem[]): number {
  return items.filter((item) => item.kind === "session" && item.rank <= WAITING_RANK_MAX).length;
}
