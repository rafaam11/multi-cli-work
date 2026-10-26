import { useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderX, GitBranch, Plus } from "lucide-react";
import type {
  RemoteMirrorFolder,
  RemoteMirrorPlace,
  RemoteMirrorSection,
  RemoteSessionSummary,
} from "@shared/remote-types";
import { AgentIcon } from "../brand-icons";
import { statusLabels } from "../session-labels";
import { isAwaiting } from "./session-list-model";
import { remoteAgent } from "./SessionList";

/** 펼친 줄은 이 기기의 취향이라 기기에만 둔다. 키는 `w:<업무 프로젝트>`·`f:<폴더>`다. */
const EXPANDED_KEY = "mcw.remote.treeExpanded.v1";

function loadExpanded(): Set<string> | null {
  try {
    const raw = window.localStorage.getItem(EXPANDED_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(value) ? new Set(value.filter((key): key is string => typeof key === "string")) : null;
  } catch {
    return null;
  }
}

function saveExpanded(keys: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(EXPANDED_KEY, JSON.stringify([...keys]));
  } catch {
    /* unavailable storage */
  }
}

const sectionKey = (section: RemoteMirrorSection) => `w:${section.workProject?.id ?? ""}`;
const folderKey = (folder: RemoteMirrorFolder) => `f:${folder.id}`;

/** 처음 여는 기기: 업무 프로젝트는 펴 두고 폴더는 접어 둔다 — 사이드바를 처음 연 모양이다. */
function defaultExpanded(tree: readonly RemoteMirrorSection[]): Set<string> {
  return new Set(tree.map(sectionKey));
}

function isBusy(session: RemoteSessionSummary | undefined): boolean {
  return session !== undefined && (session.status === "working" || isAwaiting(session.status));
}

interface ProjectTreeProps {
  tree: readonly RemoteMirrorSection[];
  sessions: readonly RemoteSessionSummary[];
  /** 호스트가 지금 보여 주는 곳 — 그 줄을 표시한다. */
  place: RemoteMirrorPlace;
  /** 호스트 그리드에 떠 있는 세션. */
  onScreenSessionIds: readonly string[];
  disabled: boolean;
  /** 넓은 화면이면 폴더·worktree 줄을 누를 때 호스트가 그곳으로 간다. 없으면 펼치기만 한다. */
  onSelectFolder?(projectId: string, worktreeId: string | null): void;
  onNewSession(projectId: string, worktreeId: string | null): void;
  onOpenSession(sessionId: string): void;
}

/**
 * 메인 사이드바 아래쪽의 프로젝트 영역. 트리 모양(묶음·정렬·봇 브랜치 제외)은 호스트가 계산해 보낸
 * 그대로 그리고, 세션 이름·상태만 sessions 목록에서 찾는다.
 */
export function ProjectTree({
  tree,
  sessions,
  place,
  onScreenSessionIds,
  disabled,
  onSelectFolder,
  onNewSession,
  onOpenSession,
}: ProjectTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded() ?? defaultExpanded(tree));
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const change = (next: Set<string>) => {
    setExpanded(next);
    saveExpanded(next);
  };
  const toggle = (key: string) => {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    change(next);
  };
  const expandAll = () =>
    change(new Set(tree.flatMap((section) => [sectionKey(section), ...section.folders.map(folderKey)])));
  const collapseAll = () => change(new Set());
  const expandBusy = () => {
    const next = new Set<string>();
    for (const section of tree) {
      const busy = section.folders.filter((folder) => folder.sessionIds.some((id) => isBusy(byId.get(id))));
      if (busy.length === 0) continue;
      next.add(sectionKey(section));
      for (const folder of busy) next.add(folderKey(folder));
    }
    change(next);
  };

  const isHere = (projectId: string, worktreeId: string | null) =>
    place.kind === "folder" && place.projectId === projectId && place.worktreeId === worktreeId;

  const sessionRows = (ids: readonly string[]) =>
    ids.map((id) => {
      const session = byId.get(id);
      if (!session) return null;
      return (
        <li key={id}>
          <button
            type="button"
            className={["m-tree-session", `status-${session.status}`, onScreenSessionIds.includes(id) ? "on-screen" : ""]
              .filter(Boolean)
              .join(" ")}
            aria-label={`${session.label}, ${statusLabels[session.status]}`}
            onClick={() => onOpenSession(id)}
          >
            <span className={`m-dot m-dot-${session.status}`} aria-hidden="true" />
            <AgentIcon agent={remoteAgent(session)} size={13} />
            <span className="m-row-name">{session.label}</span>
          </button>
        </li>
      );
    });

  const addButton = (label: string, projectId: string, worktreeId: string | null) => (
    <button
      type="button"
      className="m-row-action m-tree-add"
      aria-label={`${label}에서 새 세션`}
      title="새 세션"
      disabled={disabled}
      onClick={() => onNewSession(projectId, worktreeId)}
    >
      <Plus size={14} />
    </button>
  );

  const workspaceRow = (
    folder: RemoteMirrorFolder,
    worktreeId: string | null,
    branch: string,
    changedFileCount: number,
    sessionIds: readonly string[],
  ) => (
    <li key={worktreeId ?? "main"}>
      <div className={["m-tree-row", "m-tree-workspace", isHere(folder.id, worktreeId) ? "current" : ""].filter(Boolean).join(" ")}>
        <button
          type="button"
          className="m-row-open"
          aria-label={`${folder.name} ${branch}`}
          disabled={!onSelectFolder || disabled}
          onClick={() => onSelectFolder?.(folder.id, worktreeId)}
        >
          <GitBranch size={12} aria-hidden="true" />
          <span className="m-row-name">{branch}</span>
          <span className="m-tree-meta">
            변경 {changedFileCount} · 세션 {sessionIds.length}
          </span>
        </button>
        {addButton(`${folder.name} ${branch}`, folder.id, worktreeId)}
      </div>
      {sessionIds.length > 0 ? <ul className="m-rows m-tree-children">{sessionRows(sessionIds)}</ul> : null}
    </li>
  );

  const folderRow = (folder: RemoteMirrorFolder) => {
    const open = expanded.has(folderKey(folder));
    const awaiting = folder.sessionIds.some((id) => {
      const session = byId.get(id);
      return session !== undefined && isAwaiting(session.status);
    });
    const here = place.kind === "folder" && place.projectId === folder.id;
    return (
      <li key={folder.id}>
        <div className={["m-tree-row", "m-tree-folder", here ? "current" : ""].filter(Boolean).join(" ")}>
          <button
            type="button"
            className="m-tree-toggle"
            aria-label={`${folder.name} ${open ? "접기" : "펼치기"}`}
            aria-expanded={open}
            onClick={() => toggle(folderKey(folder))}
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <button
            type="button"
            className="m-row-open"
            aria-label={folder.name}
            disabled={folder.missing}
            onClick={() => {
              if (onSelectFolder && !disabled) {
                onSelectFolder(folder.id, null);
                if (!open) toggle(folderKey(folder));
              } else toggle(folderKey(folder));
            }}
          >
            {folder.missing ? <FolderX size={14} aria-hidden="true" /> : <Folder size={14} aria-hidden="true" />}
            <span className="m-row-name">{folder.name}</span>
            {awaiting ? <span className="m-dot m-dot-awaiting-approval" role="status" aria-label="대기 세션 있음" /> : null}
            {folder.sessionIds.length > 0 ? <span className="m-shelf-count">{folder.sessionIds.length}</span> : null}
          </button>
          {folder.missing ? null : addButton(folder.name, folder.id, null)}
        </div>
        {open ? (
          <ul className="m-rows m-tree-children">
            {folder.main
              ? workspaceRow(folder, null, folder.main.branch, folder.main.changedFileCount, folder.rootSessionIds)
              : sessionRows(folder.rootSessionIds)}
            {folder.worktrees.map((worktree) =>
              workspaceRow(folder, worktree.id, worktree.branch, worktree.changedFileCount, worktree.sessionIds),
            )}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <section className="m-panel m-tree" aria-label="프로젝트">
      <div className="m-panel-heading">
        <h2>프로젝트</h2>
        <div className="m-scope" role="group" aria-label="프로젝트 펼침">
          <button type="button" onClick={expandAll}>
            모두
          </button>
          <button type="button" onClick={collapseAll}>
            접기
          </button>
          <button type="button" title="돌고 있거나 기다리는 세션이 있는 폴더만 펼치기" onClick={expandBusy}>
            작업중
          </button>
        </div>
      </div>
      {tree.length === 0 ? <p className="m-empty">등록된 폴더가 없습니다</p> : null}
      <ul className="m-rows" aria-label="프로젝트 목록">
        {tree.map((section) => {
          if (!section.workProject) return section.folders.map(folderRow);
          const key = sectionKey(section);
          const open = expanded.has(key);
          return (
            <li key={key}>
              <button
                type="button"
                className="m-shelf-toggle m-tree-section"
                aria-expanded={open}
                onClick={() => toggle(key)}
              >
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span className="m-shelf-name">{section.workProject.name}</span>
                <span className="m-shelf-count">{section.folders.length}</span>
              </button>
              {open ? <ul className="m-rows m-tree-children">{section.folders.map(folderRow)}</ul> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
