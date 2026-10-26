import type { RemoteSessionSummary } from "@shared/remote-types";

export function pathIdentity(value: string): string {
  const windows = /^[a-z]:[\\/]|^\\\\/i.test(value);
  const normalized = windows ? value.replace(/\\/g, "/").toLowerCase() : value;
  return normalized.replace(/\/+$/, "") || "/";
}

export function shortPath(value?: string): string {
  if (!value) return "경로 정보 없음";
  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : value;
}

export function projectLabel(session: RemoteSessionSummary): string {
  return session.projectName || (session.projectRootPath?.replace(/[\\/]+$/, "").split(/[\\/]/).pop()) ||
    (session.projectId ? "이름 없는 프로젝트" : "프로젝트 없음");
}

export interface PathGroup { key: string; label: string; sessions: RemoteSessionSummary[] }
export interface ProjectGroup { key: string; label: string; root?: string; paths: PathGroup[] }

/** Map insertion order follows the host; status updates never move a row under a finger. */
export function groupSessionsByPath(sessions: RemoteSessionSummary[]): ProjectGroup[] {
  const projects = new Map<string, ProjectGroup>();
  for (const session of sessions) {
    const key = JSON.stringify(session.projectId);
    let project = projects.get(key);
    if (!project) {
      project = { key, label: projectLabel(session), root: session.projectRootPath, paths: [] };
      projects.set(key, project);
    }
    const pathKey = JSON.stringify([key, session.cwd ? pathIdentity(session.cwd) : null]);
    let group = project.paths.find(path => path.key === pathKey);
    if (!group) {
      group = { key: pathKey, label: session.cwd || "경로 정보 없음", sessions: [] };
      project.paths.push(group);
    }
    group.sessions.push(session);
  }
  return [...projects.values()];
}
