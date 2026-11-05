import { useRef } from "react";
import { List, Plus, X } from "lucide-react";
import type { RemoteSessionSummary } from "@shared/remote-types";
import { SessionGroups } from "./SessionGroups";
import { useModalFocus } from "./use-modal-focus";

interface Props {
  hostId: string;
  hostName: string;
  sessions: RemoteSessionSummary[];
  activeId: string | null;
  onClose(): void;
  onSelect(id: string): void;
  /** 세션 화면에서 전체 목록(홈)으로. */
  onShowList?(): void;
  onNewSession?(): void;
}

/** 좁은 폰 화면의 ☰ 서랍. 넓은 폭에서는 같은 목록이 레일로 늘 옆에 있다. */
export function SessionDrawer({ hostId, hostName, sessions, activeId, onClose, onSelect, onShowList, onNewSession }: Props) {
  const panel = useRef<HTMLElement>(null);
  useModalFocus(panel, onClose);
  return (
    <div className="m-drawer-overlay">
      <button className="m-drawer-backdrop" aria-label="사이드바 닫기" onClick={onClose} tabIndex={-1} />
      <aside className="m-drawer" ref={panel} role="dialog" aria-modal="true" aria-label="프로젝트와 경로별 세션">
        <header className="m-rail-head">
          <h2 className="m-host-name">{hostName}</h2>
          {onShowList ? (
            <button type="button" className="m-icon" aria-label="전체 목록" onClick={onShowList}>
              <List size={20} aria-hidden="true" />
            </button>
          ) : null}
          <button type="button" className="m-icon" aria-label="세션 사이드바 닫기" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="m-drawer-scroll">
          <SessionGroups hostId={hostId} sessions={sessions} activeId={activeId} onSelect={onSelect} />
        </div>
        {onNewSession ? (
          <footer className="m-rail-foot">
            <button type="button" className="m-new-button" onClick={onNewSession}>
              <Plus size={18} aria-hidden="true" />
              <span>새 세션</span>
            </button>
          </footer>
        ) : null}
      </aside>
    </div>
  );
}
