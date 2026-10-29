import { useMemo, useState } from "react";
import "@shared/v2-api";
import { HerdrTerminal } from "./HerdrTerminal";
import { createHostTransport, type HostTerminalConnectionApi } from "./host-transport";

export interface HostTerminalPaneProps {
  sessionId: string;
  onError?(message: string): void;
  onFocus?(): void;
  /** Android supplies its authenticated native gateway adapter through the same contract. */
  api?: HostTerminalConnectionApi;
  fontSize?: number;
  fontFamily?: string;
}
export function HostTerminalPane({ sessionId, onError, onFocus, api = window.mcwV2, fontSize, fontFamily }: HostTerminalPaneProps) {
  const [viewerId, setViewerId] = useState<string | null>(null);
  const transport = useMemo(() => api ? createHostTransport(api, { onIdentity: setViewerId }) : null, [api]);
  if (!transport) return <div className="herdr-terminal-status" role="status">v2 호스트 연결이 준비되지 않았습니다.</div>;
  return <HerdrTerminal sessionId={sessionId} transport={transport} viewerId={viewerId ?? "awaiting-authentication"} ownerId={null} sizeOwnerId={null}
    fontSize={fontSize} fontFamily={fontFamily} onError={onError} onFocus={onFocus} />;
}
