import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMouseButton, ClientMouseKind, ClientPaneInputEvent, HerdrTerminalEvent, HerdrTerminalTransport, PaneSurfaceFrame } from "@shared/herdr-surface-types";
import { drawSurface, DEFAULT_CANVAS_THEME, type CanvasTheme } from "./canvas-renderer";
import { GraphicsCache } from "./graphics-cache";
import { applySurfaceEvent, selectionText, type CellPoint } from "./surface-model";
import { CompositionInput, keyInput, modifiers } from "./terminal-input";
import "./herdr-terminal.css";

export interface HerdrTerminalProps {
  sessionId: string;
  transport: HerdrTerminalTransport;
  viewerId: string;
  ownerId: string | null;
  sizeOwnerId?: string | null;
  fontSize?: number;
  fontFamily?: string;
  theme?: CanvasTheme;
  onError?(message: string): void;
  onFocus?(): void;
  onReady?(ready:boolean): void;
}
type Selection = { start: CellPoint; end: CellPoint };
const mouseButton = (button: number): ClientMouseButton => button === 1 ? "Middle" : button === 2 ? "Right" : "Left";

/** The same DOM/Canvas component runs in Electron and the Android host gateway. */
export function HerdrTerminal({ sessionId, transport, viewerId, ownerId, sizeOwnerId = ownerId,
  fontSize = 14, fontFamily = '"Cascadia Code", "D2Coding", "Noto Sans Mono CJK KR", monospace',
  theme = DEFAULT_CANVAS_THEME, onError, onFocus,onReady }: HerdrTerminalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null), viewportRef = useRef<HTMLDivElement>(null), inputRef = useRef<HTMLTextAreaElement>(null);
  const surfaceRef = useRef<PaneSurfaceFrame | null>(null), graphicsRef = useRef<GraphicsCache | null>(null);
  if (!graphicsRef.current) graphicsRef.current = new GraphicsCache();
  const ownershipRef = useRef({ ownerId, sizeOwnerId });
  const viewerRef=useRef(viewerId);viewerRef.current=viewerId;
  const disconnectedRef = useRef(false), pendingSnapshotRef = useRef(true), aliveRef = useRef(true);
  const imeRef = useRef(new CompositionInput()), selectionRef = useRef<Selection | null>(null);
  const pointerRef = useRef<{ id: number; reporting: boolean; button: ClientMouseButton } | null>(null);
  const errorRef = useRef(onError); errorRef.current = onError;
  const readyRef=useRef(onReady);readyRef.current=onReady;
  const [surface, setSurface] = useState<PaneSurfaceFrame | null>(null);
  const [ownership, setOwnership] = useState({ ownerId, sizeOwnerId });
  const [disconnectedAt, setDisconnectedAt] = useState<{observedAt:number|null} | null>(null), [synchronizing, setSynchronizing] = useState(true);
  const [selection, setSelection] = useState<Selection | null>(null), [blink, setBlink] = useState(true);
  const [composing,setComposing]=useState(false);
  const [graphicsVersion, setGraphicsVersion] = useState(0), [error, setError] = useState<string | null>(null);
  const safeFontSize = Math.max(8, Math.min(40, fontSize));
  const [cellWidth, setCellWidth] = useState(safeFontSize * 0.6);
  const cellHeight = Math.ceil(safeFontSize * 1.4);
  const metrics = { cellWidth, cellHeight, fontSize: safeFontSize, fontFamily };
  const controlled = ownership.ownerId === viewerId;
  const writable = controlled && disconnectedAt === null && !synchronizing && !!surface;

  const reportError = useCallback((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (aliveRef.current) { setError(message); errorRef.current?.(message); }
  }, []);
  const run = useCallback((action: () => void | Promise<unknown>) => {
    try { void Promise.resolve(action()).catch(reportError); } catch (cause) { reportError(cause); }
  }, [reportError]);
  const canWrite = () => ownershipRef.current.ownerId === viewerId && !disconnectedRef.current && !pendingSnapshotRef.current && !!surfaceRef.current;
  const send = (event: ClientPaneInputEvent | null) => { if (event && canWrite()) run(() => transport.sendInput(sessionId, event)); };

  useEffect(() => {
    ownershipRef.current = { ownerId, sizeOwnerId };
    setOwnership({ ownerId, sizeOwnerId });
  }, [ownerId, sizeOwnerId]);

  useEffect(() => {
    aliveRef.current = true;
    readyRef.current?.(false);
    setComposing(false);imeRef.current=new CompositionInput();
    if(inputRef.current)inputRef.current.value='';
    surfaceRef.current = null; setSurface(null);
    selectionRef.current = null; setSelection(null);
    disconnectedRef.current = false; setDisconnectedAt(null);
    pendingSnapshotRef.current = true; setSynchronizing(true);
    graphicsRef.current?.dispose();
    const requestSnapshot = () => run(() => transport.requestSnapshot(sessionId));
    const receive = (event: HerdrTerminalEvent) => {
      if (!aliveRef.current) return;
      if (event.type === "ownership") {
        ownershipRef.current = { ownerId: event.ownerId, sizeOwnerId: event.sizeOwnerId };
        if(event.ownerId!==viewerRef.current){setComposing(false);imeRef.current=new CompositionInput();if(inputRef.current)inputRef.current.value='';}
        setOwnership(ownershipRef.current); return;
      }
      if (event.type === "disconnected") {
        readyRef.current?.(false);
        setComposing(false);imeRef.current=new CompositionInput();if(inputRef.current)inputRef.current.value='';
        disconnectedRef.current = true; setDisconnectedAt({observedAt:event.observedAt ?? null});
        pendingSnapshotRef.current = true; setSynchronizing(true); return;
      }
      // After loss/gap, only a complete snapshot can establish a valid scene.
      if (pendingSnapshotRef.current && event.type === "patch") return;
      // Surface revisions belong to a terminal connection. A new bridge may
      // start at revision 1 while the Herdr server keeps the same boot ID.
      let result = applySurfaceEvent(disconnectedRef.current ? null : surfaceRef.current, event);
      if (result.status === "stale" && event.type !== "patch" && pendingSnapshotRef.current
        && event.surface.surface_revision === surfaceRef.current?.surface_revision) result = applySurfaceEvent(null, event);
      if (result.status === "resync") {
        readyRef.current?.(false);
        if (!pendingSnapshotRef.current) { pendingSnapshotRef.current = true; setSynchronizing(true); requestSnapshot(); }
        return;
      }
      if (result.status !== "applied" || !result.surface) return;
      const previous = surfaceRef.current;
      surfaceRef.current = result.surface; setSurface(result.surface);
      pendingSnapshotRef.current = false; setSynchronizing(false);
      disconnectedRef.current = false; setDisconnectedAt(null); setError(null);
      if (event.type !== "patch") {
        if (previous?.boot_id !== result.surface.boot_id) graphicsRef.current?.dispose();
        if (previous?.boot_id !== result.surface.boot_id || previous?.frame.width !== result.surface.frame.width || previous?.frame.height !== result.surface.frame.height) {
          selectionRef.current = null; setSelection(null);
        }
        void graphicsRef.current?.update(result.surface.graphics).then(() => { if (aliveRef.current) setGraphicsVersion((n) => n + 1); });
      }
    };
    let unsubscribe = () => {};
    try { unsubscribe = transport.subscribe(sessionId, receive, reportError); requestSnapshot(); } catch (cause) { reportError(cause); }
    return () => { aliveRef.current = false;readyRef.current?.(false); unsubscribe(); graphicsRef.current?.dispose(); };
  }, [sessionId, transport, run, reportError]);

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    context.font = `${safeFontSize}px ${fontFamily}`;
    const measured = context.measureText("M").width;
    if (measured > 0) setCellWidth(Math.ceil(measured * 100) / 100);
  }, [safeFontSize, fontFamily]);

  useEffect(() => {
    if (!surface) return;
    const blinking = !!surface.frame.cursor?.visible && (surface.frame.cursor.shape === 0 || surface.frame.cursor.shape % 2 === 1)
      || surface.frame.cells.some((cell) => !!(cell.modifier & 48));
    if (!blinking) { setBlink(true); return; }
    const timer = window.setInterval(() => setBlink((value) => !value), 600);
    return () => window.clearInterval(timer);
  }, [surface?.boot_id, surface?.frame.cursor?.visible, surface?.frame.cursor?.shape, !!surface?.frame.cells.some((c) => !!(c.modifier & 48))]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !surface) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const width = surface.frame.width * cellWidth, height = surface.frame.height * cellHeight;
    // Canvas backing stores are bounded separately from the semantic grid.
    const scale = Math.min(dpr, 16384 / width, 16384 / height, Math.sqrt(32_000_000 / (width * height)));
    canvas.width = Math.max(1, Math.ceil(width * scale)); canvas.height = Math.max(1, Math.ceil(height * scale));
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    drawSurface(context, surface, metrics, theme, graphicsRef.current!, { selection, blinkVisible: blink });
    if(!pendingSnapshotRef.current&&!disconnectedRef.current)readyRef.current?.(true);
  }, [surface, cellWidth, cellHeight, safeFontSize, fontFamily, theme, selection, blink, graphicsVersion]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    let lastSize = "";
    const resize = (width: number, height: number) => {
      if (ownershipRef.current.ownerId !== viewerId || ownershipRef.current.sizeOwnerId !== viewerId || disconnectedRef.current || width <= 0 || height <= 0) return;
      const cols = Math.max(2, Math.min(500, Math.floor(width / cellWidth))), rows = Math.max(2, Math.min(300, Math.floor(height / cellHeight)));
      if (cols * rows > 250_000) return;
      const signature = `${cols}:${rows}:${cellWidth}:${cellHeight}`;
      if (signature === lastSize) return;
      lastSize = signature;
      run(() => transport.resize(sessionId, { cols, rows, cell_width_px: Math.round(cellWidth), cell_height_px: cellHeight }));
    };
    const observer = new ResizeObserver((entries) => { const rect = entries[0]?.contentRect; if (rect) resize(rect.width, rect.height); });
    observer.observe(viewport);
    const rect = viewport.getBoundingClientRect(); resize(rect.width, rect.height);
    return () => observer.disconnect();
  }, [sessionId, transport, viewerId, ownership.ownerId, ownership.sizeOwnerId, cellWidth, cellHeight, run]);

  const updateSelection = (value: Selection | null) => { selectionRef.current = value; setSelection(value); };
  const point = (event: { clientX: number; clientY: number }): CellPoint => {
    const rect = canvasRef.current!.getBoundingClientRect(), grid = surfaceRef.current?.frame;
    return { x: Math.max(0, Math.min((grid?.width ?? 1) - 1, Math.floor((event.clientX - rect.left) / cellWidth))), y: Math.max(0, Math.min((grid?.height ?? 1) - 1, Math.floor((event.clientY - rect.top) / cellHeight))) };
  };
  const paneAt = (p: CellPoint) => surfaceRef.current?.panes.find((pane) => p.x >= pane.inner_rect.x && p.y >= pane.inner_rect.y && p.x < pane.inner_rect.x + pane.inner_rect.width && p.y < pane.inner_rect.y + pane.inner_rect.height);
  const sendMouse = (event: { clientX: number; clientY: number; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }, kind: ClientMouseKind, lines = 1) => {
    const p = point(event), pane = paneAt(p), rect = canvasRef.current!.getBoundingClientRect();
    if (!pane?.mouse_reporting) return;
    const column = p.x - pane.inner_rect.x, row = p.y - pane.inner_rect.y;
    send({ Mouse: { kind, position: pane.sgr_pixel_mouse
      ? { Pixels: { x: Math.max(0, Math.round(event.clientX - rect.left - pane.inner_rect.x * cellWidth)), y: Math.max(0, Math.round(event.clientY - rect.top - pane.inner_rect.y * cellHeight)), column, row } }
      : { Cell: { column, row } }, geometry: { cols: pane.inner_rect.width, rows: pane.inner_rect.height, width_px: Math.round(pane.inner_rect.width * cellWidth), height_px: pane.inner_rect.height * cellHeight }, modifiers: modifiers(event), lines } });
  };
  const copy = () => {
    const selected = selectionRef.current, current = surfaceRef.current;
    if (selected && current && navigator.clipboard?.writeText) run(() => navigator.clipboard.writeText(selectionText(current, selected.start, selected.end)));
  };
  const scroll = (direction: "Up" | "Down", lines: number) => { if (canWrite()) run(() => transport.scroll(sessionId, { direction, lines })); };
  const focusedPane = surface?.panes.find((pane) => pane.focused) ?? surface?.panes[0];
  const scrollMetrics = focusedPane?.scroll;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wheel = (event: WheelEvent) => {
      if (!canWrite() || !event.deltaY) return;
      event.preventDefault();
      const direction = event.deltaY < 0 ? "Up" : "Down", lines = Math.min(100, Math.max(1, Math.ceil(Math.abs(event.deltaY) / (event.deltaMode === 0 ? cellHeight : 1))));
      const pane = paneAt(point(event));
      if (pane?.mouse_reporting && pane.alternate_screen_active && !event.shiftKey) sendMouse(event, direction === "Up" ? "ScrollUp" : "ScrollDown", lines);
      else scroll(direction, lines);
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, [sessionId, transport, viewerId, cellWidth, cellHeight, run]);

  return <section className="herdr-terminal" data-testid="herdr-terminal" data-session-id={sessionId} data-mode={controlled ? "control" : "observe"}>
    <div className="herdr-terminal-toolbar">
      <span className="herdr-terminal-mode">{controlled ? "제어 중" : "관찰 중"}</span>
      <span className="herdr-terminal-size-owner">크기 소유자: {ownership.sizeOwnerId === viewerId ? "이 화면" : ownership.sizeOwnerId ?? "없음"}</span>
      {surface && <span>{surface.frame.width} × {surface.frame.height}</span>}
      <div className="herdr-terminal-actions">
        {controlled ? <button type="button" onClick={() => run(() => transport.releaseControl(sessionId, viewerId))}>제어 놓기</button>
          : <button type="button" disabled={disconnectedAt !== null || synchronizing} onClick={() => run(() => transport.requestControl(sessionId, viewerId))}>제어 요청</button>}
        <button type="button" disabled={!selection} onClick={copy}>복사</button>
      </div>
    </div>
    {(disconnectedAt !== null || synchronizing || error) && <div className="herdr-terminal-status" role="status">
      {disconnectedAt !== null ? `연결 끊김 · 마지막 관찰 ${disconnectedAt.observedAt===null?"없음":new Date(disconnectedAt.observedAt).toLocaleTimeString()}` : error ?? "화면 동기화 중…"}
    </div>}
    <div className="herdr-terminal-viewport" ref={viewportRef}>
      <canvas ref={canvasRef} aria-label="터미널 화면" role="img" onContextMenu={(event) => { if (writable && paneAt(point(event))?.mouse_reporting && !event.shiftKey) event.preventDefault(); }}
        onPointerDown={(event) => {
          if (!surfaceRef.current) return;
          const p = point(event), reporting = canWrite() && !!paneAt(p)?.mouse_reporting && !event.shiftKey;
          pointerRef.current = { id: event.pointerId, reporting, button: mouseButton(event.button) };
          event.currentTarget.setPointerCapture?.(event.pointerId);
          if (reporting) sendMouse(event, { Down: mouseButton(event.button) });
          else if (event.button === 0) updateSelection({ start: p, end: p });
          inputRef.current?.focus({ preventScroll: true });
        }}
        onPointerMove={(event) => {
          const active = pointerRef.current;
          if (!active && canWrite() && !event.shiftKey && paneAt(point(event))?.mouse_reporting) { sendMouse(event, "Moved"); return; }
          if (active?.id !== event.pointerId) return;
          if (active.reporting) sendMouse(event, { Drag: active.button });
          else if (selectionRef.current) updateSelection({ ...selectionRef.current, end: point(event) });
        }}
        onPointerUp={(event) => {
          const active = pointerRef.current;
          if (active?.id !== event.pointerId) return;
          if (active.reporting) sendMouse(event, { Up: active.button });
          pointerRef.current = null; event.currentTarget.releasePointerCapture?.(event.pointerId);
        }}
        onPointerCancel={() => { pointerRef.current = null; }} />
      <textarea ref={inputRef} className={`herdr-terminal-input${composing?' is-composing':''}`} aria-label="터미널 입력" aria-readonly={!writable} readOnly={!writable} autoCapitalize="off" autoCorrect="off" spellCheck={false}
        style={{left:(surface?.frame.cursor?.x??0)*cellWidth,top:(surface?.frame.cursor?.y??0)*cellHeight,height:cellHeight,
          maxWidth:`calc(100% - ${(surface?.frame.cursor?.x??0)*cellWidth}px)`,
          fontSize:safeFontSize,fontFamily,lineHeight:`${cellHeight}px`,color:theme.foreground,background:theme.background}}
        onFocus={onFocus} onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "c") { event.preventDefault(); copy(); return; }
          if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "v") return;
          if (event.key === "Escape" && selectionRef.current) { updateSelection(null); event.preventDefault(); return; }
          const input = keyInput(event.nativeEvent);
          if (input) { event.preventDefault(); send(input); }
        }}
        onCompositionStart={() => {imeRef.current.start();setComposing(true);}}
        onCompositionEnd={(event) => { send(imeRef.current.end(event.data));setComposing(false); event.currentTarget.value = ""; }}
        onInput={(event) => {
          const native = event.nativeEvent as InputEvent;
          const text = event.currentTarget.value;
          send(imeRef.current.input(text, native.isComposing));
          if (!native.isComposing) event.currentTarget.value = "";
        }}
        onPaste={(event) => { event.preventDefault(); send({ Paste: event.clipboardData.getData("text/plain") }); event.currentTarget.value = ""; }}
        onCopy={(event) => { const s = selectionRef.current, current = surfaceRef.current; if (s && current) { event.preventDefault(); event.clipboardData.setData("text/plain", selectionText(current, s.start, s.end)); } }} />
    </div>
    {scrollMetrics && scrollMetrics.max_offset_from_bottom > 0 && <div className="herdr-terminal-scroll">
      <span>{scrollMetrics.offset_from_bottom} / {scrollMetrics.max_offset_from_bottom}줄</span>
      <input type="range" aria-label="터미널 스크롤" min={0} max={scrollMetrics.max_offset_from_bottom} value={scrollMetrics.max_offset_from_bottom - scrollMetrics.offset_from_bottom} disabled={!writable}
        onChange={(event) => { const target = scrollMetrics.max_offset_from_bottom - Number(event.currentTarget.value), delta = target - scrollMetrics.offset_from_bottom; if (delta) scroll(delta > 0 ? "Up" : "Down", Math.abs(delta)); }} />
      <button type="button" disabled={!writable || !scrollMetrics.offset_from_bottom} onClick={() => scroll("Down", scrollMetrics.offset_from_bottom)}>맨 아래</button>
    </div>}
  </section>;
}
