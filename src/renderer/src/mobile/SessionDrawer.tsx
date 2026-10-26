import { useEffect, useRef, useState } from "react";
import type { RemoteSessionSummary } from "@shared/remote-types";
import { groupSessionsByPath } from "./session-groups";
import { STATUS_LABEL } from "./SessionList";

interface Props {
  hostId: string;
  hostName: string;
  sessions: RemoteSessionSummary[];
  activeId: string | null;
  onClose(): void;
  onSelect(id: string): void;
}

export function SessionDrawer({ hostId, hostName, sessions, activeId, onClose, onSelect }: Props) {
  const storageKey = `mcw.drawer.${hostId}`;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, boolean> : {};
    } catch { return {}; }
  });
  const panel = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const items = panel.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
      if (!items?.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, []);
  const toggle = (key: string) => {
    const next = { ...collapsed, [key]: !collapsed[key] };
    setCollapsed(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Private browsing. */ }
  };
  return <div className="m-drawer-overlay">
    <button className="m-drawer-backdrop" aria-label="사이드바 닫기" onClick={onClose} tabIndex={-1} />
    <aside className="m-drawer" ref={panel} role="dialog" aria-modal="true" aria-label="프로젝트와 경로별 세션">
      <header className="m-bar"><h1>{hostName}</h1><button onClick={onClose} aria-label="세션 사이드바 닫기">×</button></header>
      <div className="m-drawer-scroll">
        {groupSessionsByPath(sessions).map(project => <section key={project.key} className="m-drawer-project">
          <button className="m-drawer-group" aria-expanded={!collapsed[project.key]} onClick={() => toggle(project.key)}>
            <span aria-hidden="true">{collapsed[project.key] ? "▸" : "▾"}</span><strong>{project.label}</strong><small>{project.paths.reduce((count, path) => count + path.sessions.length, 0)}</small>
          </button>
          {!collapsed[project.key] && <>
            {project.root && <p className="m-drawer-root">{project.root}</p>}
            {project.paths.map(path => <div key={path.key} className="m-drawer-path">
              <button className="m-drawer-group" aria-expanded={!collapsed[path.key]} onClick={() => toggle(path.key)}>
                <span aria-hidden="true">{collapsed[path.key] ? "▸" : "▾"}</span><span className="m-drawer-path-label">{path.label}</span>
              </button>
              {!collapsed[path.key] && path.sessions.map(session => <button key={session.id} className="m-session" aria-current={session.id === activeId ? "true" : undefined} onClick={() => onSelect(session.id)}>
                <span className={`m-dot m-dot-${session.status}`} aria-hidden="true" />
                <span className="m-session-text"><span className="m-session-label">{session.label}</span><span className="m-session-meta">{session.kind} · {STATUS_LABEL[session.status]}{session.worktreeBranch ? ` · ${session.worktreeBranch}` : ""}</span></span>
              </button>)}
            </div>)}
          </>}
        </section>)}
        {!sessions.length && <p className="m-empty">열려 있는 세션이 없습니다</p>}
      </div>
    </aside>
  </div>;
}
