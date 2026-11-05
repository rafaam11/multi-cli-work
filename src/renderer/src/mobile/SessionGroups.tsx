import { useState } from "react";
import { ChevronDown, ChevronRight, EyeOff } from "lucide-react";
import type { RemoteSessionSummary } from "@shared/remote-types";
import { AgentIcon } from "../brand-icons";
import { statusLabels } from "../session-labels";
import { SHELF_TEXT } from "../shelves";
import { groupSessionsByPath, shortPath } from "./session-groups";
import { isAwaiting } from "./session-list-model";
import { remoteAgent } from "./SessionList";

interface SessionGroupsProps {
  /** 접은 묶음을 호스트마다 기기에 기억한다. */
  hostId: string;
  sessions: RemoteSessionSummary[];
  activeId: string | null;
  onSelect(id: string): void;
}

/**
 * 프로젝트 → 경로 → 세션 묶음. 폰의 ☰ 서랍과 넓은 폭의 레일이 같이 쓴다. 순서는 호스트가 보낸 그대로라
 * 상태가 바뀌어도 손가락 밑의 행이 움직이지 않는다. 경로가 하나뿐인 프로젝트는 경로 줄을 생략한다.
 */
export function SessionGroups({ hostId, sessions, activeId, onSelect }: SessionGroupsProps) {
  const storageKey = `mcw.drawer.${hostId}`;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  const toggle = (key: string) => {
    const next = { ...collapsed, [key]: !collapsed[key] };
    setCollapsed(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* Private browsing. */
    }
  };
  // 숨긴 세션은 아래 접힌 칸으로 — 지금 보고 있는 세션이면 제자리에 둔다.
  const shown = sessions.filter((session) => !session.hidden || session.id === activeId);
  const hidden = sessions.filter((session) => session.hidden && session.id !== activeId);
  // 다른 키는 "접힘"이지만 숨김 칸은 처음에 접혀 있어서 "펼침"을 기억한다.
  const hiddenKey = "open:hidden";
  const hiddenOpen = collapsed[hiddenKey] === true;

  const row = (session: RemoteSessionSummary) => (
    <button
      type="button"
      key={session.id}
      className={["m-group-row", isAwaiting(session.status) && session.id !== activeId ? "m-group-row-await" : ""]
        .filter(Boolean)
        .join(" ")}
      aria-current={session.id === activeId ? "true" : undefined}
      aria-label={`${session.label}, ${statusLabels[session.status]}`}
      title={session.label}
      onClick={() => onSelect(session.id)}
    >
      <span className={`m-dot m-dot-${session.status}`} aria-hidden="true" />
      <AgentIcon agent={remoteAgent(session)} size={16} />
      <span className="m-group-row-text">
        <span className="m-group-row-name">{session.label}</span>
        <span className="m-group-row-meta">
          <span className={`m-status-${session.status}`}>{statusLabels[session.status]}</span>
          {session.worktreeBranch ? ` · ${session.worktreeBranch}` : null}
        </span>
      </span>
    </button>
  );

  return (
    <div className="m-groups">
      {groupSessionsByPath(shown).map((project) => {
        const count = project.paths.reduce((total, path) => total + path.sessions.length, 0);
        return (
          <section key={project.key} className="m-groups-project" aria-label={project.label}>
            <button
              type="button"
              className="m-groups-head"
              aria-expanded={!collapsed[project.key]}
              title={project.root}
              onClick={() => toggle(project.key)}
            >
              {collapsed[project.key] ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
              <span className="m-groups-name">{project.label}</span>
              <span className="m-count">{count}</span>
            </button>
            {collapsed[project.key]
              ? null
              : project.paths.map((path) => (
                  <div key={path.key} className="m-groups-path">
                    {project.paths.length > 1 ? (
                      <button
                        type="button"
                        className="m-groups-path-head"
                        aria-expanded={!collapsed[path.key]}
                        title={path.label}
                        onClick={() => toggle(path.key)}
                      >
                        {collapsed[path.key] ? <ChevronRight size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
                        <span className="m-groups-path-label">{shortPath(path.label)}</span>
                      </button>
                    ) : null}
                    {collapsed[path.key] ? null : path.sessions.map(row)}
                  </div>
                ))}
          </section>
        );
      })}
      {shown.length === 0 ? <p className="m-empty">열려 있는 세션이 없습니다</p> : null}
      {hidden.length > 0 ? (
        <section className="m-groups-project m-groups-hidden" aria-label={SHELF_TEXT.hidden.name}>
          <button type="button" className="m-groups-head" aria-expanded={hiddenOpen} onClick={() => toggle(hiddenKey)}>
            {hiddenOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
            <EyeOff size={14} aria-hidden="true" />
            <span className="m-groups-name">{SHELF_TEXT.hidden.name}</span>
            <span className="m-count">{hidden.length}</span>
          </button>
          {hiddenOpen ? hidden.map(row) : null}
        </section>
      ) : null}
    </div>
  );
}
