import { useState } from "react";
import type { RemoteSessionSummary } from "@shared/remote-types";
import { projectLabel, shortPath } from "./session-groups";

export function SessionContext({ session, onOpen }: { session: RemoteSessionSummary; onOpen(): void }) {
  const [expanded, setExpanded] = useState(false);
  return <div className="m-context">
    <button aria-label="세션 사이드바 열기" onClick={onOpen}>☰</button>
    <button className="m-context-path" aria-label="현재 세션 경로" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      <strong>{projectLabel(session)}</strong><span>{shortPath(session.cwd)}</span>
    </button>
    {expanded && <div className="m-context-full"><span>{session.cwd || "경로 정보 없음 · PC 앱 업데이트가 필요합니다"}</span><button onClick={() => setExpanded(false)} aria-label="전체 경로 닫기">×</button></div>}
  </div>;
}
