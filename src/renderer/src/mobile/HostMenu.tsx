import { LogOut, MonitorSmartphone } from "lucide-react";
import { BottomSheet } from "./BottomSheet";
import type { RemoteClientState } from "./remote-client";

export const CONNECTION_LABEL: Record<RemoteClientState, string | null> = {
  connecting: "연결 중…",
  open: null,
  reconnecting: "다시 연결하는 중…",
  unauthorized: "연결이 해제되었습니다",
  incompatible: "호스트와 버전이 맞지 않습니다",
};

interface HostMenuProps {
  hostName: string;
  connection: RemoteClientState;
  /** 셸(앱) 안이면 "호스트 목록"으로 돌아가고, 브라우저면 이 기기의 연결을 끊는다. */
  leaveLabel?: string;
  onLeave(): void;
  onClose(): void;
}

/** 폰 목록·레일 머리줄의 ⋯ — 자주 누르지 않고 되돌리기 어려운 것을 화면에서 뺀다. */
export function HostMenu({ hostName, connection, leaveLabel, onLeave, onClose }: HostMenuProps) {
  const disconnect = leaveLabel === undefined;
  return (
    <BottomSheet label="호스트 메뉴" onClose={onClose}>
      <header className="m-sheet-head">
        <span className={`m-conn m-conn-${connection}`} aria-hidden="true" />
        <div className="m-sheet-head-text">
          <h2 className="m-sheet-title">{hostName}</h2>
          <p className="m-sheet-sub">{CONNECTION_LABEL[connection] ?? "연결됨"}</p>
        </div>
      </header>
      <section className="m-sheet-section">
        <button type="button" className={disconnect ? "m-sheet-item m-sheet-danger" : "m-sheet-item"} onClick={onLeave}>
          {disconnect ? <LogOut size={20} aria-hidden="true" /> : <MonitorSmartphone size={20} aria-hidden="true" />}
          <span className="m-sheet-item-text">{leaveLabel ?? "연결 해제"}</span>
        </button>
      </section>
    </BottomSheet>
  );
}
