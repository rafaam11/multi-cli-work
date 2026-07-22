import type { AgentView } from "@shared/agent-types";
import { SHIFT_ENTER_BYTES } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import { X } from "lucide-react";
import { useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { TerminalPane } from "./TerminalPane";

interface WorkspaceSplitProps {
  session: TerminalSessionView;
  agents: AgentView[];
  /** The secondary pane's session; null (or the primary itself) renders a single terminal. */
  splitSession: TerminalSessionView | null;
  splitSessionLabel: string | null;
  refreshRequests: Readonly<Record<string, number>>;
  onAttached(session: TerminalSessionView): void;
  onRefreshComplete(sessionId: string): void;
  onError(message: string): void;
  onCloseSplit(): void;
}

/**
 * Two TerminalPanes side by side — each pane keeps its own xterm, fit addon and resize reporting,
 * so the split is pure layout. Two panes at most: comparing a pair of agents is the use case, a
 * tiling window manager is not.
 */
export function WorkspaceSplit({
  session,
  agents,
  splitSession,
  splitSessionLabel,
  refreshRequests,
  onAttached,
  onRefreshComplete,
  onError,
  onCloseSplit,
}: WorkspaceSplitProps) {
  const shiftEnterBytes = (pane: TerminalSessionView): string | null =>
    SHIFT_ENTER_BYTES[agents.find((agent) => agent.id === pane.kind)?.shiftEnter ?? "enter"];
  const [ratio, setRatio] = useState(0.5);
  const container = useRef<HTMLDivElement>(null);
  const secondary = splitSession && splitSession.id !== session.id ? splitSession : null;

  const beginResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const bounds = container.current?.getBoundingClientRect();
      if (!bounds || bounds.width === 0) return;
      setRatio(Math.min(0.8, Math.max(0.2, (moveEvent.clientX - bounds.left) / bounds.width)));
    };
    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  if (!secondary) {
    return <TerminalPane
        key={session.id}
        session={session}
        shiftEnterBytes={shiftEnterBytes(session)}
        refreshRequest={refreshRequests[session.id] ?? 0}
        onAttached={onAttached}
        onRefreshComplete={onRefreshComplete}
        onError={onError}
      />;
  }

  return (
    <div className="workspace-split" ref={container} style={{ "--split-ratio": ratio } as CSSProperties}>
      <div className="split-pane split-primary">
        <TerminalPane
        key={session.id}
        session={session}
        shiftEnterBytes={shiftEnterBytes(session)}
        refreshRequest={refreshRequests[session.id] ?? 0}
        onAttached={onAttached}
        onRefreshComplete={onRefreshComplete}
        onError={onError}
      />
      </div>
      <div
        className="split-divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="분할 크기 조절"
        onMouseDown={beginResize}
      />
      <div className="split-pane split-secondary">
        <header className="split-pane-header">
          <span className="split-pane-title" title={splitSessionLabel ?? undefined}>
            {splitSessionLabel}
          </span>
          <button className="icon-button" type="button" onClick={onCloseSplit} aria-label="분할 닫기" title="분할 닫기">
            <X size={13} />
          </button>
        </header>
        <TerminalPane
          key={secondary.id}
          session={secondary}
          shiftEnterBytes={shiftEnterBytes(secondary)}
          refreshRequest={refreshRequests[secondary.id] ?? 0}
          onAttached={onAttached}
          onRefreshComplete={onRefreshComplete}
          onError={onError}
        />
      </div>
    </div>
  );
}
