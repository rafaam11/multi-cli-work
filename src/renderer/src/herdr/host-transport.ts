import type { HerdrTerminalEvent, HerdrTerminalTransport, PaneSurfaceFrame, PaneSurfacePatch } from "@shared/herdr-surface-types";

export interface HostTerminalConnectionApi {
  subscribeTerminal(sessionId: string, listener: (event: unknown) => void): () => void;
  terminalCommand(sessionId: string, command: Record<string, unknown>): Promise<void>;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
/** Credentials and sockets stay in the main/native bridge; the renderer sees events only. */
export function createHostTransport(api: HostTerminalConnectionApi, callbacks: { onIdentity?(viewerId: string): void } = {}): HerdrTerminalTransport {
  return {
    subscribe(sessionId, onEvent, onError) {
      const receive = (value: unknown, depth = 0): void => {
        if (!object(value) || depth > 3 || typeof value.sessionId === "string" && value.sessionId !== sessionId) return;
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
          onEvent({ type: "disconnected", observedAt: typeof value.observedAt === "number" ? value.observedAt : Date.now(), reason: typeof value.reason === "string" ? value.reason : undefined }); return;
        }
        if (value.type === "error") onError?.(String(value.error ?? value.message ?? "호스트 요청 실패"));
      };
      return api.subscribeTerminal(sessionId, receive);
    },
    sendInput: (sessionId, event) => api.terminalCommand(sessionId, { type: "input", data: event }),
    resize: (sessionId, size) => api.terminalCommand(sessionId, { type: "resize", cols: size.cols, rows: size.rows, cellWidthPx: size.cell_width_px, cellHeightPx: size.cell_height_px }),
    scroll: (sessionId, scroll) => api.terminalCommand(sessionId, { type: "scroll", delta: (scroll.direction === "Up" ? 1 : -1) * Math.min(1000, Math.max(1, Math.floor(scroll.lines))) }),
    requestControl: (sessionId) => api.terminalCommand(sessionId, { type: "takeOwnership" }),
    releaseControl: (sessionId) => api.terminalCommand(sessionId, { type: "releaseOwnership" }),
    requestSnapshot: (sessionId) => api.terminalCommand(sessionId, { type: "snapshot" }),
  };
}
