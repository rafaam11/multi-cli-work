import { useEffect, useRef, useState } from "react";
import type { BoardMessage } from "@shared/board-types";
import { mergeBoardMessage } from "./board-model";
import { errorMessage } from "./ipc-error";

export function useProjectMessages(projectId: string | null, hidden: boolean, onUnreadChange: (count: number) => void) {
  const [snapshot, setSnapshot] = useState<{ projectId: string | null; messages: BoardMessage[]; ready: boolean; error: string | null }>({ projectId: null, messages: [], ready: false, error: null });
  const [retry, setRetry] = useState(0);
  const [unread, setUnread] = useState<Set<string>>(new Set());
  const hiddenRef = useRef(hidden);
  const unseenDuringLoad = useRef(new Set<string>());
  hiddenRef.current = hidden;
  useEffect(() => {
    let disposed = false;
    let loading = true;
    let current: BoardMessage[] = [];
    const duringLoad = new Map<string, BoardMessage>();
    unseenDuringLoad.current = new Set();
    setUnread(new Set());
    setSnapshot({ projectId, messages: [], ready: false, error: null });
    if (!projectId) return;
    const unsubscribe = window.multiCliWork.board.onChange(message => {
      if (disposed || message.projectId !== projectId) return;
      if (loading) {
        if (hiddenRef.current && !duringLoad.has(message.id)) unseenDuringLoad.current.add(message.id);
        duringLoad.set(message.id, message);
      }
      else if (hiddenRef.current && !current.some(item => item.id === message.id)) setUnread(ids => new Set(ids).add(message.id));
      current = mergeBoardMessage(current, message).slice(-500);
      setSnapshot(previous => ({ ...previous, messages: current }));
    });
    void window.multiCliWork.board.list(projectId).then(messages => {
      if (disposed) return;
      const knownIds = new Set(messages.map(message => message.id));
      current = messages;
      for (const message of duringLoad.values()) current = mergeBoardMessage(current, message);
      current = current.slice(-500);
      loading = false;
      if (hiddenRef.current) setUnread(new Set([...unseenDuringLoad.current].filter(id => !knownIds.has(id))));
      setSnapshot({ projectId, messages: current, ready: true, error: null });
    }).catch(cause => {
      if (!disposed) { loading = false; setSnapshot({ projectId, messages: current, ready: false, error: errorMessage(cause) }); }
    });
    return () => { disposed = true; unsubscribe(); };
  }, [projectId, retry]);
  useEffect(() => { if (!hidden) { unseenDuringLoad.current.clear(); setUnread(new Set()); } }, [hidden]);
  useEffect(() => { onUnreadChange(hidden ? unread.size : 0); }, [hidden, unread, onUnreadChange]);
  return {
    messages: snapshot.projectId === projectId ? snapshot.messages : [],
    ready: snapshot.projectId === projectId && snapshot.ready,
    error: snapshot.projectId === projectId ? snapshot.error : null,
    reload: () => setRetry(value => value + 1),
  };
}
