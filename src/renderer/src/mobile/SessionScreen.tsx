import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  AArrowDown,
  AArrowUp,
  ArrowUp,
  CircleStop,
  Ellipsis,
  Keyboard,
  Maximize2,
  Menu,
  Minimize2,
  Pin,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { REMOTE_SESSION_NAME_MAX, type RemoteSessionSummary } from "@shared/remote-types";
import { DEFAULT_SETTINGS } from "@shared/settings-types";
import { splitReplay } from "@shared/terminal-replay";
import { createAutoFit, type AutoFit, type AutoFitState } from "./auto-fit";
import { TERMINAL_FONT_INDEX, TERMINAL_FONT_SIZES, type TerminalSize } from "./initial-size";
import { loadPhonePref, savePhonePref } from "./phone-prefs";
import type { RemoteClient } from "./remote-client";
import { projectLabel } from "./session-groups";
import { SessionMenu } from "./SessionMenu";
import { statusLabels as STATUS_LABEL } from "../session-labels";
import { terminalMinimumContrast, terminalTheme } from "../terminal-themes";
import { currentTheme, useResolvedTheme } from "../theme";
import { clipboardKeyAction, createReplayGate, encodeComposerInput, phoneQuickKeys, QUICK_KEYS } from "./terminal-input";
import { planTouchScroll, shouldSendWheel } from "./touch-scroll";
import { useOverlayEntry } from "./use-session-drawer";

interface SessionScreenProps {
  client: RemoteClient;
  session: RemoteSessionSummary;
  deviceId: string;
  /** 넓은 화면(PC): 목록이 옆에 있고, 터미널을 이 창 크기에 맞추며, 키보드로 바로 입력한다. */
  wide?: boolean;
  /** 이 화면에 들어가는 터미널 크기를 잴 때마다 알린다 — 새 세션을 그 크기로 띄우려고. */
  onMeasured?(size: TerminalSize): void;
  /** 폰: 세션 목록이 옆 레일에 있다 — 머리줄 없이 터미널이 위까지 차고, ⋯는 터미널 위에 뜬다. */
  rail?: boolean;
  /** 폰 머리줄의 ☰ — 프로젝트·경로별 세션 서랍을 연다. */
  onOpenDrawer?(): void;
  /** 폰 머리줄의 "대기 N" — 다른 세션이 답을 기다린다. */
  awaiting?: { count: number; onJump(): void } | null;
  /**
   * 넓은 화면 그리드에서 키보드 입력을 받는 칸인지. 포커스 칸만 터미널에 포커스를 주고 도구 줄을 보인다.
   * 그리드가 아니면 늘 true다.
   */
  focused?: boolean;
  /** 그리드 칸 — 머리줄을 줄이고 ✕로 칸을 닫는다. */
  onClose?(): void;
  /** 그리드에서 이 칸을 누르면 포커스를 옮긴다. */
  onFocus?(): void;
  /**
   * 호스트 화면을 따라 그리는 그리드(칸이 많다). 포커스 칸만 PTY 크기를 이 창에 맞추고, 나머지는 호스트
   * 크기 그대로 그린다 — 칸마다 맞추면 열두 칸이 서로 크기를 빼앗는다.
   */
  fitOnlyWhenFocused?: boolean;
  /** 머리줄 ✕ 앞에 그리는 칸 조작(열 나누기·합치기). */
  paneActions?: ReactNode;
  /** 호스트가 이 칸을 확대해 보이는 중인지. */
  zoomed?: boolean;
  /** 있으면 머리줄에 확대·확대 해제 버튼을 둔다. */
  onToggleZoom?(): void;
  /** 있으면 머리줄을 끌어 다른 칸으로 옮길 수 있다. */
  onHeaderDragStart?(event: DragEvent<HTMLElement>): void;
  /** 있으면 이름을 두 번 눌러 바꿀 수 있다. 빈 이름은 붙인 이름을 지운다. */
  onRename?(name: string): void;
  /**
   * 바뀔 때마다 포커스 칸이 키보드 포커스를 다시 가져온다. 목록에서 이미 포커스인 세션을 누르면 칸은
   * 그대로라 `focused`가 바뀌지 않는다 — 그때도 입력이 터미널로 가게.
   */
  focusRequest?: number;
  onReady?(ready: boolean): void;
}

const FONT_SIZES = TERMINAL_FONT_SIZES;
const AUTO_FIT_DEBOUNCE_MS = 150;

/**
 * 세션 화면. 폰과 넓은 화면 모두 PTY를 이 화면 크기에 맞추는 것이 기본이다 — 폰에서 PC 열 수 그대로
 * 그리면 옆으로 넘친다. 호스트가 크기를 되찾으면(입력·패인 크기 변경) 맞춤이 멈추고 "다시 맞추기"를
 * 띄운다. 폰은 ⋯ 메뉴의 "PC 크기 유지"로 맞춤을 끌 수 있고, 그 선택은 기기에 남는다.
 */
export function SessionScreen({
  client,
  session,
  deviceId,
  wide = false,
  onMeasured,
  rail = false,
  onOpenDrawer,
  awaiting = null,
  focused = true,
  onClose,
  onFocus,
  fitOnlyWhenFocused = false,
  paneActions,
  zoomed = false,
  onToggleZoom,
  onHeaderDragStart,
  onRename,
  focusRequest,
  onReady,
}: SessionScreenProps) {
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const autoFitRef = useRef<AutoFit | null>(null);
  const [fitState, setFitState] = useState<AutoFitState>("fitting");
  /** 폰: 높이가 낮을 때(키보드가 열렸을 때) 접어 두는 키 줄을 펼쳐 둘지. */
  const [keysOpen, setKeysOpen] = useState(() => loadPhonePref("keysOpenWhenLow"));
  const menu = useOverlayEntry("session-menu");
  const draftRef = useRef<HTMLTextAreaElement>(null);
  // 넓은 화면은 키보드가 있다 — 빠른 키 바와 입력창은 접어 둔다.
  const [toolsOpen, setToolsOpen] = useState(!wide);
  const [fontIndex, setFontIndex] = useState(TERMINAL_FONT_INDEX);
  const onMeasuredRef = useRef(onMeasured);
  onMeasuredRef.current = onMeasured;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const fitOnlyRef = useRef(fitOnlyWhenFocused);
  fitOnlyRef.current = fitOnlyWhenFocused;
  /** 이름을 고치는 중이면 입력 중인 글. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const resolvedTheme = useResolvedTheme();
  const [draft, setDraft] = useState("");
  /** 삭제는 되돌릴 수 없어서 두 번 묻는다. window.confirm은 Android WebView가 조용히 거절한다. */
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const running = session.status !== "exited" && session.status !== "error";
  const reattachRef = useRef<(() => void) | null>(null);
  const rescaleRef = useRef<(() => void) | null>(null);
  const wasRunning = useRef(running);
  /** 그리드 칸 — 머리줄은 호스트 패인처럼 아이콘 버튼 한 줄이다. */
  const pane = onClose !== undefined;

  // 끝났던 세션이 다시 돌기 시작했다 — 이 화면에서든, 다른 기기에서든, 호스트에서든. 새 프로세스의
  // 출력은 sequence를 처음부터 세므로, 문을 비우고 새로 붙어야 이전 번호에 밀려 버려지지 않는다.
  // 재시작을 요청한 연결에만 오는 started가 아니라 목록의 상태를 신호로 쓰는 이유다.
  useEffect(() => {
    if (running && !wasRunning.current) reattachRef.current?.();
    wasRunning.current = running;
  }, [running]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let live = true;
    let attachment = 0;
    const notReady = () => { attachment++; onReadyRef.current?.(false); };
    notReady();
    const terminal = new Terminal({
      fontSize: FONT_SIZES[TERMINAL_FONT_INDEX],
      fontFamily: 'ui-monospace, "Cascadia Mono", Menlo, "DejaVu Sans Mono", monospace',
      scrollback: DEFAULT_SETTINGS.terminal.scrollback,
      // 폰은 손가락으로 스크롤한다(touch-scroll) — FitAddon이 스크롤바 자리로 14px를 빼서 오른쪽이 비지
      // 않게 얇은 위치 표시만 남긴다. 475px 폭에서 두 열이 더 들어간다.
      ...(wide ? {} : { overviewRuler: { width: 4 } }),
      scrollOnEraseInDisplay: true,
      cursorBlink: false,
      theme: terminalTheme(currentTheme()),
      minimumContrastRatio: terminalMinimumContrast(currentTheme()),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fit;
    const reportSize = () => {
      const dims = fit.proposeDimensions();
      if (dims && dims.cols >= 2 && dims.rows >= 1) onMeasuredRef.current?.({ cols: dims.cols, rows: dims.rows });
    };
    reportSize();

    // 키보드로 쓰는 넓은 화면에서만 복사·붙여넣기 키를 가로챈다. 폰 화면의 키 처리는 전과 같다.
    if (wide) {
      terminal.attachCustomKeyEventHandler((event) => {
        const action = clipboardKeyAction(event, terminal.hasSelection());
        if (action === null) return true;
        // 붙여넣기는 xterm이 키를 먹지 않게만 한다 — 브라우저의 paste 이벤트가 xterm에 닿아 처리된다.
        if (action === "paste") return false;
        event.preventDefault();
        // copy 이벤트는 xterm이 받아 선택 영역을 클립보드에 넣는다. http 출처라 navigator.clipboard는 없다.
        if (action === "copy" && event.type === "keydown") document.execCommand("copy");
        return false;
      });
    }

    // 폰도 넓은 화면과 같은 규칙으로 맞춘다. "PC 크기 유지"를 켜 둔 기기만 처음부터 호스트 크기다.
    const keepHost = !wide && loadPhonePref("keepHostSize");
    const autoFit = createAutoFit({
      deviceId,
      keepHost,
      measure: () => {
        const dims = fit.proposeDimensions();
        return dims ? { cols: dims.cols, rows: dims.rows } : null;
      },
      resize: (cols, rows) => {
        if (fitOnlyRef.current && !focusedRef.current) return;
        client.send({ type: "resize", sessionId: session.id, cols, rows });
      },
      release: () => {
        client.send({ type: "releaseSize", sessionId: session.id });
      },
      onChange: setFitState,
    });
    autoFitRef.current = autoFit;
    setFitState(keepHost ? "host" : "fitting");
    if (wide && focusedRef.current) terminal.focus();

    let replaying = false;
    let currentSize: { cols: number | null; rows: number | null } = { cols: null, rows: null };
    const writeOutput = (data: string) => {
      if (data) terminal.write(data);
    };
    const gate = createReplayGate(writeOutput, (replay) => {
      replaying = true;
      const revision = attachment;
      const current = () => live && revision === attachment;
      for (const step of splitReplay(replay)) {
        if (step.type === "data") writeOutput(step.data);
        else terminal.write("", () => {
          if (current()) terminal.resize(step.cols, step.rows);
        });
      }
      // This barrier precedes gate.pending and subsequent live data. The current PTY dimensions
      // can have changed while its old frames were parsing, so restore the latest size here.
      terminal.write("", () => {
        if (!current()) return;
        replaying = false;
        applySize(currentSize.cols, currentSize.rows);
        requestAnimationFrame(() => { if (current()) onReadyRef.current?.(true); });
      });
    });
    // 따라 그리는 그리드의 포커스 없는 칸은 호스트 PTY 크기 그대로 그리고, 칸에 들어가게 줄인다 — 넘쳐서
    // 잘리거나 스크롤바가 생기지 않게. 포커스 칸은 크기를 가져와 맞추므로 그대로 둔다.
    let scaleFrame = 0;
    let scale = 1;
    const rescale = () => {
      scaleFrame = 0;
      const element = terminal.element;
      const screen = element?.querySelector<HTMLElement>(".xterm-screen");
      if (!element) return;
      const width = screen?.offsetWidth ?? 0;
      const height = screen?.offsetHeight ?? 0;
      if (!fitOnlyRef.current || focusedRef.current || width === 0 || height === 0 || host.clientWidth === 0) {
        scale = 1;
        element.style.transform = "";
        host.classList.remove("m-scaled");
        return;
      }
      scale = Math.min(host.clientWidth / width, host.clientHeight / height, 2);
      element.style.transformOrigin = "0 0";
      element.style.transform = `scale(${scale})`;
      host.classList.add("m-scaled");
    };

    // xterm은 마우스 위치를 화면 요소의 왼쪽 위에서 잰 거리로 칸을 정하고 CSS 축소는 모른다 — 줄인 칸에서
    // 끌어 고르면 다른 줄이 잡힌다. 그 칸에서 시작한 마우스 동작만 축소를 되돌린 위치로 바꿔 xterm에 넘긴다.
    let pointerInside = false;
    const unscalePointer = (event: MouseEvent) => {
      if (event.type === "mousedown") pointerInside = host.contains(event.target as Node);
      if (!pointerInside || scale === 1) return;
      const screen = terminal.element?.querySelector<HTMLElement>(".xterm-screen");
      if (!screen) return;
      const rect = screen.getBoundingClientRect();
      Object.defineProperty(event, "clientX", { value: rect.left + (event.clientX - rect.left) / scale });
      Object.defineProperty(event, "clientY", { value: rect.top + (event.clientY - rect.top) / scale });
    };
    const releasePointer = () => {
      pointerInside = false;
    };
    window.addEventListener("mousedown", unscalePointer, true);
    window.addEventListener("mousemove", unscalePointer, true);
    window.addEventListener("mouseup", unscalePointer, true);
    window.addEventListener("mouseup", releasePointer);
    const scheduleScale = () => {
      if (scaleFrame === 0) scaleFrame = requestAnimationFrame(rescale);
    };
    rescaleRef.current = scheduleScale;
    const offResize = terminal.onResize(scheduleScale);

    const applySize = (cols: number | null, rows: number | null) => {
      if (cols !== null && rows !== null && (terminal.cols !== cols || terminal.rows !== rows)) terminal.resize(cols, rows);
    };

    const offMessage = client.onMessage((message) => {
      if (!("sessionId" in message) || message.sessionId !== session.id) return;
      if (message.type === "attached") {
        attachment++;
        const revision = attachment;
        terminal.write("", () => { if (live && revision === attachment) terminal.reset(); });
        terminal.options.scrollback = message.scrollback ?? DEFAULT_SETTINGS.terminal.scrollback;
        currentSize = { cols: message.cols, rows: message.rows };
        autoFit.attached();
        gate.attached(message.replay, message.sequence);
      } else if (message.type === "data") {
        gate.data(message.data, message.sequence);
      } else if (message.type === "size") {
        currentSize = { cols: message.cols, rows: message.rows };
        if (!replaying) applySize(message.cols, message.rows);
        autoFit.owner(message.sizeOwner);
      }
    });
    reattachRef.current = () => {
      notReady();
      gate.reset();
      client.send({ type: "attach", sessionId: session.id });
    };
    const offState = client.onState((state) => {
      notReady();
      if (state !== "open") return;
      gate.reset();
      client.send({ type: "attach", sessionId: session.id });
    });
    client.send({ type: "attach", sessionId: session.id });
    const input = terminal.onData((data) => client.send({ type: "write", sessionId: session.id, data }));

    // 터미널 영역이나 창 크기가 바뀌면 다시 맞춘다. 끄는 동안 연달아 오는 신호는 마지막에 한 번만 쓴다.
    // 둘을 구분한다: 영역은 스크롤바가 생기는 것만으로도 바뀌지만, 창 크기는 사용자가 바꾼 것이다.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let windowResized = false;
    const scheduleFit = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (windowResized) autoFit.windowResized();
        else autoFit.areaChanged();
        windowResized = false;
      }, AUTO_FIT_DEBOUNCE_MS);
    };
    const onWindowResize = () => {
      windowResized = true;
      scheduleFit();
      reportSize();
    };
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            scheduleFit();
            scheduleScale();
          })
        : null;
    observer?.observe(host);
    window.addEventListener("resize", onWindowResize);

    // xterm은 손가락 드래그를 스크롤백 이동으로 바꾸지 않는다. 세로 드래그는 여기서 받아, 넘친 틀
    // (PC 크기로 그릴 때)과 스크롤백 사이에 나눠 쓴다. 가로 드래그는 틀의 기본 스크롤에 맡긴다.
    let touchStart: { x: number; y: number } | null = null;
    let touchAxis: "x" | "y" | null = null;
    let lastTouchY = 0;
    let touchCarry = 0;
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        touchStart = null;
        return;
      }
      const touch = event.touches[0]!;
      touchStart = { x: touch.clientX, y: touch.clientY };
      lastTouchY = touch.clientY;
      touchAxis = null;
      touchCarry = 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!touchStart || event.touches.length !== 1) return;
      const touch = event.touches[0]!;
      if (touchAxis === null) {
        const dx = Math.abs(touch.clientX - touchStart.x);
        const dy = Math.abs(touch.clientY - touchStart.y);
        if (dx < 6 && dy < 6) return;
        touchAxis = dy >= dx ? "y" : "x";
      }
      if (touchAxis !== "y") return;
      event.preventDefault();
      const dy = touch.clientY - lastTouchY;
      lastTouchY = touch.clientY;
      const screen = host.querySelector<HTMLElement>(".xterm-screen");
      const cellHeight = screen && terminal.rows > 0 ? screen.clientHeight / terminal.rows : 16;
      const buffer = terminal.buffer.active;
      // claude 같은 전체 화면 앱은 스크롤백이 없고 휠 입력으로 스스로 스크롤한다.
      const fullScreen = shouldSendWheel(buffer.type, terminal.modes?.mouseTrackingMode ?? "none");
      const step = planTouchScroll(
        {
          containerTop: host.scrollTop,
          containerMax: host.scrollHeight - host.clientHeight,
          viewportY: buffer.viewportY,
          baseY: buffer.baseY,
          unbounded: fullScreen,
        },
        dy,
        cellHeight,
        touchCarry,
      );
      if (step.containerDelta !== 0) host.scrollTop += step.containerDelta;
      if (step.lines !== 0) {
        if (fullScreen && screen) sendWheel(screen, step.lines, cellHeight);
        else terminal.scrollLines(step.lines);
      }
      touchCarry = step.remainder;
    };
    // 휠을 xterm에 넘기면 앱이 켠 마우스 방식(SGR 등)에 맞춰 PTY로 보낸다 — PC에서 휠을 굴린 것과 같다.
    const sendWheel = (target: HTMLElement, steps: number, cellHeight: number) => {
      const rect = target.getBoundingClientRect();
      for (let index = 0; index < Math.abs(steps); index += 1) {
        target.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: Math.sign(steps) * cellHeight,
            deltaMode: WheelEvent.DOM_DELTA_PIXEL,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    };
    const onTouchEnd = () => {
      touchStart = null;
    };
    host.addEventListener("touchstart", onTouchStart, { passive: true });
    host.addEventListener("touchmove", onTouchMove, { passive: false });
    host.addEventListener("touchend", onTouchEnd);
    host.addEventListener("touchcancel", onTouchEnd);

    return () => {
      offMessage();
      offState();
      input.dispose();
      reattachRef.current = null;
      rescaleRef.current = null;
      offResize.dispose();
      if (scaleFrame !== 0) cancelAnimationFrame(scaleFrame);
      window.removeEventListener("mousedown", unscalePointer, true);
      window.removeEventListener("mousemove", unscalePointer, true);
      window.removeEventListener("mouseup", unscalePointer, true);
      window.removeEventListener("mouseup", releasePointer);
      observer?.disconnect();
      window.removeEventListener("resize", onWindowResize);
      if (resizeTimer) clearTimeout(resizeTimer);
      autoFitRef.current = null;
      host.removeEventListener("touchstart", onTouchStart);
      host.removeEventListener("touchmove", onTouchMove);
      host.removeEventListener("touchend", onTouchEnd);
      host.removeEventListener("touchcancel", onTouchEnd);
      // 폰이 크기를 맞춰 쥐고 있었으면 떠날 때 PC에 돌려준다 — 폰 폭으로 줄어든 채 남지 않게.
      if (!wide && autoFit.state() === "fitting") client.send({ type: "releaseSize", sessionId: session.id });
      client.send({ type: "detach", sessionId: session.id });
      live = false;
      notReady();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [client, session.id, deviceId, wide]);

  // 호스트 창과 같은 규칙 — 라이트에서만 흰 트루컬러 글자를 진하게 끌어올리고, 터미널은 다시 만들지 않는다.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = terminalTheme(resolvedTheme);
    terminal.options.minimumContrastRatio = terminalMinimumContrast(resolvedTheme);
  }, [resolvedTheme]);

  // 그리드에서 이 칸이 포커스를 받으면 키보드 입력도 이리로 온다.
  useEffect(() => {
    if (wide && focused) terminalRef.current?.focus();
    // 따라 그리는 그리드에서는 포커스를 받은 칸이 이제서야 크기를 가져온다.
    const autoFit = autoFitRef.current;
    if (fitOnlyRef.current && focused && autoFit && autoFit.state() !== "host") autoFit.refit();
    rescaleRef.current?.();
  }, [wide, focused]);

  useEffect(() => {
    if (focusRequest !== undefined && wide && focusedRef.current) terminalRef.current?.focus();
  }, [focusRequest, wide]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) terminal.options.fontSize = FONT_SIZES[fontIndex];
    // 글자 크기가 바뀌면 같은 창에 들어가는 열·행 수가 달라진다.
    autoFitRef.current?.areaChanged();
    const dims = fitRef.current?.proposeDimensions();
    if (dims && dims.cols >= 2 && dims.rows >= 1) onMeasuredRef.current?.({ cols: dims.cols, rows: dims.rows });
    rescaleRef.current?.();
  }, [fontIndex]);

  const sendKeys = (data: string) => client.send({ type: "write", sessionId: session.id, data });

  const submitDraft = () => {
    sendKeys(encodeComposerInput(draft));
    setDraft("");
    if (draftRef.current) draftRef.current.style.height = "";
  };

  // 포커스는 누르기를 마친 뒤에 옮긴다. 끌어서 글을 골랐으면 옮기지 않는다 — 포커스를 받은 칸은 크기를
  // 다시 맞추고, 크기가 바뀌면 xterm이 고른 것을 지우기 때문이다. 고른 칸에 키보드를 줘 Ctrl+C가 닿게 한다.
  const focusOnClick = (event: ReactMouseEvent<HTMLElement>) => {
    if ((event.target as Element).closest("button, input, form")) return;
    const terminal = terminalRef.current;
    if (terminal?.hasSelection()) {
      terminal.focus();
      return;
    }
    onFocus?.();
  };

  if (!wide) {
    const approval = session.status === "awaiting-approval";
    const place = [projectLabel(session), session.worktreeBranch].filter(Boolean).join(" · ");
    return (
      <main
        className={[
          "m-session-screen",
          "m-phone-session",
          rail ? "m-rail-session" : "",
          keysOpen ? "m-keys-open" : "",
          approval ? "m-has-hot" : "",
          `status-${session.status}`,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {rail ? null : (
          <header className="m-topbar">
            {onOpenDrawer ? (
              <button type="button" className="m-icon" aria-label="세션 사이드바 열기" onClick={onOpenDrawer}>
                <Menu size={22} aria-hidden="true" />
              </button>
            ) : null}
            <button type="button" className="m-title" aria-haspopup="dialog" onClick={menu.open}>
              <span className="m-title-main">
                <span className={`m-dot m-dot-${session.status}`} aria-hidden="true" />
                <span className="m-title-text">{session.label}</span>
              </span>
              <span className="m-title-sub">
                <span className={`m-status-${session.status}`}>{STATUS_LABEL[session.status]}</span>
                {place ? ` · ${place}` : null}
              </span>
            </button>
            {awaiting && awaiting.count > 0 ? (
              <button type="button" className="m-await-pill" onClick={awaiting.onJump}>
                대기 {awaiting.count}
              </button>
            ) : null}
            <button type="button" className="m-icon" aria-label="세션 메뉴" aria-haspopup="dialog" onClick={menu.open}>
              <Ellipsis size={22} aria-hidden="true" />
            </button>
          </header>
        )}
        <div className="m-terminal" role="region" aria-label={`${session.label} 터미널`}>
          <div className="m-terminal-host" ref={hostRef} />
          {rail ? (
            <button type="button" className="m-fab-menu" aria-label="세션 메뉴" aria-haspopup="dialog" onClick={menu.open}>
              <Ellipsis size={20} aria-hidden="true" />
            </button>
          ) : null}
          {fitState === "paused" ? (
            <span className="m-fit-notice m-phone-fit-notice" role="status">
              <span>PC가 크기를 가져갔습니다</span>
              <button type="button" onClick={() => autoFitRef.current?.refit()}>
                다시 맞추기
              </button>
            </span>
          ) : null}
        </div>
        <div className="m-bottom">
          <div className="m-keys" role="group" aria-label="빠른 키">
            {phoneQuickKeys(approval).map((key) => (
              <button
                type="button"
                key={key.label}
                className={key.hot ? "m-key m-key-hot" : "m-key"}
                aria-label={key.ariaLabel}
                onClick={() => sendKeys(key.data)}
              >
                {key.label}
              </button>
            ))}
          </div>
          <form
            className="m-composer"
            onSubmit={(event) => {
              event.preventDefault();
              submitDraft();
            }}
          >
            <button
              type="button"
              className="m-icon m-keys-toggle"
              aria-label="키 줄"
              aria-pressed={keysOpen}
              onClick={() => {
                savePhonePref("keysOpenWhenLow", !keysOpen);
                setKeysOpen(!keysOpen);
              }}
            >
              <Keyboard size={20} aria-hidden="true" />
            </button>
            <textarea
              ref={draftRef}
              aria-label="입력"
              rows={1}
              placeholder="메시지 또는 명령"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                // 여러 줄이면 몇 줄까지 늘린다(최대 높이는 phone.css).
                const area = event.target;
                area.style.height = "";
                area.style.height = `${area.scrollHeight}px`;
              }}
            />
            <button type="submit" className="m-send" aria-label="전송">
              <ArrowUp size={20} aria-hidden="true" />
            </button>
          </form>
        </div>
        {menu.isOpen ? (
          <SessionMenu
            session={session}
            fitState={fitState}
            onKeepHost={(on) => {
              savePhonePref("keepHostSize", on);
              autoFitRef.current?.keepHost(on);
            }}
            fontSize={FONT_SIZES[fontIndex]}
            canShrink={fontIndex > 0}
            canGrow={fontIndex < FONT_SIZES.length - 1}
            onFont={(step) => setFontIndex((index) => Math.min(FONT_SIZES.length - 1, Math.max(0, index + step)))}
            onRename={onRename}
            onStop={() => menu.close(() => client.send({ type: "stop", sessionId: session.id }))}
            onResume={() => menu.close(() => client.send({ type: "resume", sessionId: session.id }))}
            onRemove={() => menu.close(() => client.send({ type: "remove", sessionId: session.id }))}
            onClose={() => menu.close()}
          />
        ) : null}
      </main>
    );
  }

  return (
    <main
      className={[
        "m-session-screen",
        onClose ? "m-pane" : "",
        onClose && focused ? "m-pane-focused" : "",
        `status-${session.status}`,
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={focused || !onFocus ? undefined : focusOnClick}
    >
      <header
        className="m-bar"
        draggable={onHeaderDragStart && renaming === null ? true : undefined}
        onDragStart={onHeaderDragStart}
      >
        {onClose ? <span className={`m-dot m-dot-${session.status}`} aria-hidden="true" /> : null}
        {renaming !== null && onRename ? (
          <form
            className="m-rename"
            onSubmit={(event) => {
              event.preventDefault();
              // 그대로 두고 Enter면 바꾸지 않는다 — 자동 제목을 붙인 이름으로 굳히지 않게.
              if (renaming.trim() !== session.label) onRename(renaming.trim());
              setRenaming(null);
            }}
          >
            <input
              aria-label="세션 이름"
              autoFocus
              maxLength={REMOTE_SESSION_NAME_MAX}
              value={renaming}
              onChange={(event) => setRenaming(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setRenaming(null);
              }}
              onBlur={() => setRenaming(null)}
            />
          </form>
        ) : (
          <h1
            title={onRename ? "두 번 눌러 이름 바꾸기" : undefined}
            onDoubleClick={onRename ? () => setRenaming(session.label) : undefined}
          >
            {session.label}
          </h1>
        )}
        <span className={`m-status m-status-${session.status}`}>{STATUS_LABEL[session.status]}</span>
        {pane ? (
          // 버튼을 눌러도 칸 포커스 요청이 먼저 가지 않게 — 호스트에서 그리드가 바뀌어 엉뚱한 칸에 닿는다.
          <span className="m-pane-actions" onMouseDown={(event) => event.stopPropagation()}>
            {wide && focused ? (
              <span className="m-pane-tools">
                <button
                  type="button"
                  className={`m-icon-button ${fitState === "host" ? "active" : ""}`.trim()}
                  aria-label="호스트 크기 유지"
                  aria-pressed={fitState === "host"}
                  title="호스트 크기 유지 — 이 창에 맞추지 않기"
                  onClick={() => autoFitRef.current?.keepHost(fitState !== "host")}
                >
                  <Pin size={13} />
                </button>
                <button
                  type="button"
                  className={`m-icon-button ${toolsOpen ? "active" : ""}`.trim()}
                  aria-label="입력 도구"
                  aria-pressed={toolsOpen}
                  title="입력 도구"
                  onClick={() => setToolsOpen((open) => !open)}
                >
                  <Keyboard size={13} />
                </button>
                <button
                  type="button"
                  className="m-icon-button"
                  aria-label="글자 작게"
                  title="글자 작게"
                  onClick={() => setFontIndex((index) => Math.max(0, index - 1))}
                >
                  <AArrowDown size={13} />
                </button>
                <button
                  type="button"
                  className="m-icon-button"
                  aria-label="글자 크게"
                  title="글자 크게"
                  onClick={() => setFontIndex((index) => Math.min(FONT_SIZES.length - 1, index + 1))}
                >
                  <AArrowUp size={13} />
                </button>
                <span className="m-bar-divider" aria-hidden="true" />
              </span>
            ) : null}
            {onToggleZoom ? (
              <button
                type="button"
                className={`m-icon-button ${zoomed ? "active" : ""}`.trim()}
                aria-label={zoomed ? "확대 해제" : "패인 확대"}
                aria-pressed={zoomed}
                title={zoomed ? "확대 해제 — 다른 칸 다시 보기" : "패인 확대 — 그리드 전체로 잠시 키우기"}
                onClick={onToggleZoom}
              >
                {zoomed ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
            ) : null}
            {paneActions}
            {confirmingRemove ? (
              <>
                <button
                  type="button"
                  className="m-text-button m-danger"
                  onClick={() => {
                    client.send({ type: "remove", sessionId: session.id });
                    setConfirmingRemove(false);
                  }}
                >
                  정말 삭제
                </button>
                <button type="button" className="m-text-button" onClick={() => setConfirmingRemove(false)}>
                  취소
                </button>
              </>
            ) : (
              <span className="m-pane-life">
                {running ? (
                  <button
                    type="button"
                    className="m-icon-button"
                    aria-label="중지"
                    title="세션 중지"
                    onClick={() => client.send({ type: "stop", sessionId: session.id })}
                  >
                    <CircleStop size={13} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="m-icon-button"
                    aria-label="재시작"
                    title="세션 재시작"
                    onClick={() => client.send({ type: "resume", sessionId: session.id })}
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
                <button
                  type="button"
                  className="m-icon-button m-icon-danger"
                  aria-label="삭제"
                  title="세션 삭제 (스크롤백까지)"
                  onClick={() => setConfirmingRemove(true)}
                >
                  <Trash2 size={13} />
                </button>
              </span>
            )}
            <button type="button" className="m-icon-button" aria-label={`${session.label} 칸 닫기`} title="칸 닫기" onClick={onClose}>
              <X size={13} />
            </button>
          </span>
        ) : confirmingRemove ? null : running ? (
          <button type="button" onClick={() => client.send({ type: "stop", sessionId: session.id })}>
            중지
          </button>
        ) : (
          <button type="button" onClick={() => client.send({ type: "resume", sessionId: session.id })}>
            재시작
          </button>
        )}
        {pane ? null : confirmingRemove ? (
          <>
            <button
              type="button"
              className="m-danger"
              onClick={() => {
                client.send({ type: "remove", sessionId: session.id });
                setConfirmingRemove(false);
              }}
            >
              정말 삭제
            </button>
            <button type="button" onClick={() => setConfirmingRemove(false)}>
              취소
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirmingRemove(true)}>
            삭제
          </button>
        )}
      </header>
      <div className="m-tools" hidden={!focused || pane}>
        <button
          type="button"
          aria-pressed={fitState === "host"}
          onClick={() => autoFitRef.current?.keepHost(fitState !== "host")}
        >
          호스트 크기 유지
        </button>
        <button type="button" aria-pressed={toolsOpen} onClick={() => setToolsOpen((open) => !open)}>
          입력 도구
        </button>
        <button type="button" aria-label="글자 작게" onClick={() => setFontIndex((index) => Math.max(0, index - 1))}>
          A−
        </button>
        <button
          type="button"
          aria-label="글자 크게"
          onClick={() => setFontIndex((index) => Math.min(FONT_SIZES.length - 1, index + 1))}
        >
          A+
        </button>
        {wide && !pane && fitState === "paused" ? (
          <span className="m-fit-notice" role="status">
            <button type="button" onClick={() => autoFitRef.current?.refit()}>
              다시 맞추기
            </button>
            <span>호스트가 크기를 가져갔습니다</span>
          </span>
        ) : null}
      </div>
      <div className="m-terminal" role="region" aria-label={`${session.label} 터미널`}>
        <div className="m-terminal-host" ref={hostRef} />
        {pane && wide && focused && fitState === "paused" ? (
          <span className="m-fit-notice m-fit-overlay" role="status">
            <span>호스트가 크기를 가져갔습니다</span>
            <button type="button" className="m-text-button" onClick={() => autoFitRef.current?.refit()}>
              다시 맞추기
            </button>
          </span>
        ) : null}
      </div>
      {toolsOpen && focused ? (
        <>
          <div className="m-keys">
            {QUICK_KEYS.map((key) => (
              <button type="button" key={key.label} aria-label={key.ariaLabel} onClick={() => sendKeys(key.data)}>
                {key.label}
              </button>
            ))}
          </div>
          <form
            className="m-composer"
            onSubmit={(event) => {
              event.preventDefault();
              sendKeys(encodeComposerInput(draft));
              setDraft("");
            }}
          >
            <textarea aria-label="입력" rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} />
            <button type="submit">전송</button>
          </form>
        </>
      ) : null}
    </main>
  );
}
