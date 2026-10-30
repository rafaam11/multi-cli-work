import type { HerdrTerminalEvent, HerdrTerminalTransport, PaneSurfaceFrame, PaneSurfacePatch } from "@shared/herdr-surface-types";

export interface HostTerminalConnectionApi {
  subscribeTerminal(sessionId: string, listener: (event: unknown) => void): () => void;
  terminalCommand(sessionId: string, command: Record<string, unknown>): Promise<void>;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
/** Credentials and sockets stay in the main/native bridge; the renderer sees events only. */
export function createHostTransport(api: HostTerminalConnectionApi, callbacks: { onIdentity?(viewerId: string): void } = {}): HerdrTerminalTransport {
  let sequence = 0;
  const pending = new Map<string, {resolve(value:unknown):void; reject(error:Error):void; timer:ReturnType<typeof setTimeout>}>();
  const rejectPending = () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error("Terminal disconnected")); } pending.clear(); };
  const request = (sessionId:string, type:string, params?:Record<string,unknown>):Promise<unknown> => {
    if (pending.size >= 64) return Promise.reject(new Error("Too many pending terminal requests"));
    const requestId = `${Date.now().toString(36)}-${++sequence}`;
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => {pending.delete(requestId);reject(new Error("Terminal request timed out"));},10000);
      pending.set(requestId,{resolve,reject,timer});
      void api.terminalCommand(sessionId,{type,requestId,...(params ? {params} : {})}).catch(error=>{const entry=pending.get(requestId);if(entry){clearTimeout(entry.timer);pending.delete(requestId);entry.reject(error instanceof Error?error:new Error(String(error)));}});
    });
  };
  return {
    subscribe(sessionId, onEvent, onError) {
      const receive = (value: unknown, depth = 0): void => {
        if (!object(value) || depth > 3 || typeof value.sessionId === "string" && value.sessionId !== sessionId) return;
        if (value.type === "terminal-result" && typeof value.requestId === "string") {
          const entry=pending.get(value.requestId); if(entry){pending.delete(value.requestId);clearTimeout(entry.timer);if(typeof value.error === "string")entry.reject(new Error(value.error));else entry.resolve(value.result);} return;
        }
        if (typeof value.viewerId === "string") callbacks.onIdentity?.(value.viewerId);
        if (value.type === "snapshot") {
          const ownerId = typeof value.ownerId === "string" ? value.ownerId : null;
          onEvent({ type: "ownership", ownerId, sizeOwnerId: typeof value.sizeOwnerId === "string" ? value.sizeOwnerId : ownerId });
          receive(value.snapshot, depth + 1); return;
        }
        if (value.type === "frame" && value.frame) { receive(value.frame, depth + 1); return; }
        if ((value.type === "surface" || value.type === "frame") && object(value.surface)) {
          onEvent({ type: "surface", surface: value.surface as unknown as PaneSurfaceFrame }); return;
        }
        if (value.type === "patch" && object(value.patch)) { onEvent({ type: "patch", patch: value.patch as unknown as PaneSurfacePatch }); return; }
        if (value.type === "ownership") {
          const ownerId = typeof value.ownerId === "string" ? value.ownerId : null;
          onEvent({ type: "ownership", ownerId, sizeOwnerId: typeof value.sizeOwnerId === "string" ? value.sizeOwnerId : ownerId }); return;
        }
        if (value.type === "disconnected") {
          rejectPending();
          onEvent({ type: "disconnected", observedAt: typeof value.observedAt === "number" ? value.observedAt : null, reason: typeof value.reason === "string" ? value.reason : undefined }); return;
        }
        if (value.type === "error") onError?.(String(value.error ?? value.message ?? "호스트 요청 실패"));
      };
      const unsubscribe = api.subscribeTerminal(sessionId, receive);
      return () => { unsubscribe(); rejectPending(); };
    },
    sendInput: (sessionId, event) => api.terminalCommand(sessionId, { type: "input", data: event }),
    resize: (sessionId, size) => api.terminalCommand(sessionId, { type: "resize", cols: size.cols, rows: size.rows, cellWidthPx: size.cell_width_px, cellHeightPx: size.cell_height_px }),
    scroll: (sessionId, scroll) => api.terminalCommand(sessionId, { type: "scroll", delta: (scroll.direction === "Up" ? 1 : -1) * Math.min(100000, Math.max(1, Math.floor(scroll.lines))) }),
    requestControl: (sessionId) => api.terminalCommand(sessionId, { type: "takeOwnership" }),
    releaseControl: (sessionId) => api.terminalCommand(sessionId, { type: "releaseOwnership" }),
    requestSnapshot: (sessionId) => api.terminalCommand(sessionId, { type: "snapshot" }),
    clear: (sessionId) => request(sessionId,"clear"),
    search: (sessionId,params) => request(sessionId,"search",params),
    selection: (sessionId,params) => request(sessionId,"selection",params),
  };
}
