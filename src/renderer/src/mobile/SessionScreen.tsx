import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import type { RemoteSessionSummary } from "@shared/remote-types";
import { createAutoFit, type AutoFit, type AutoFitState } from "./auto-fit";
import type { RemoteClient } from "./remote-client";
import { STATUS_LABEL } from "./SessionList";
import { clipboardKeyAction, createReplayGate, encodeComposerInput, QUICK_KEYS } from "./terminal-input";
import { planTouchScroll } from "./touch-scroll";

interface SessionScreenProps {
  client: RemoteClient;
  session: RemoteSessionSummary;
  deviceId: string;
  onBack(): void;
  /** 넓은 화면(PC): 목록이 옆에 있고, 터미널을 이 창 크기에 맞추며, 키보드로 바로 입력한다. */
  wide?: boolean;
}

const FONT_SIZES = [9, 10, 11, 12, 13, 14, 16] as const;
const AUTO_FIT_DEBOUNCE_MS = 150;

/**
 * 세션 화면. 폰(좁은 화면)의 기본은 PC의 열 수를 그대로 그리고 가로로 스크롤하는 것이고, "폰 크기로"를
 * 켜면 이 화면 폭으로 PTY를 줄인다. 넓은 화면(PC)은 반대로 이 창 크기에 맞추는 것이 기본이다. 어느
 * 쪽이든 호스트가 크기를 되찾으면(입력·패인 크기 변경) 맞춤이 꺼지거나 멈춘다.
 */
export function SessionScreen({ client, session, deviceId, onBack, wide = false }: SessionScreenProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const autoFitRef = useRef<AutoFit | null>(null);
  const phoneSizeRef = useRef(false);
  const [phoneSize, setPhoneSize] = useState(false);
  const [fitState, setFitState] = useState<AutoFitState>("fitting");
  // 넓은 화면은 키보드가 있다 — 빠른 키 바와 입력창은 접어 둔다.
  const [toolsOpen, setToolsOpen] = useState(!wide);
  const [fontIndex, setFontIndex] = useState(3);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const terminal = new Terminal({
      fontSize: FONT_SIZES[3],
      fontFamily: 'ui-monospace, "Cascadia Mono", Menlo, "DejaVu Sans Mono", monospace',
      scrollback: 5_000,
      cursorBlink: false,
      theme: { background: "#101214" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fit;

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

    const autoFit = wide
      ? createAutoFit({
          deviceId,
          measure: () => {
            const dims = fit.proposeDimensions();
            return dims ? { cols: dims.cols, rows: dims.rows } : null;
          },
          resize: (cols, rows) => {
            client.send({ type: "resize", sessionId: session.id, cols, rows });
          },
          release: () => {
            client.send({ type: "releaseSize", sessionId: session.id });
          },
          onChange: setFitState,
        })
      : null;
    autoFitRef.current = autoFit;
    setFitState("fitting");
    if (wide) terminal.focus();

    const gate = createReplayGate((data) => terminal.write(data));
    const applySize = (cols: number | null, rows: number | null) => {
      if (cols !== null && rows !== null && (terminal.cols !== cols || terminal.rows !== rows)) terminal.resize(cols, rows);
    };
    const giveBackToggle = (owner: string) => {
      if (owner !== deviceId && phoneSizeRef.current) {
        phoneSizeRef.current = false;
        setPhoneSize(false);
      }
    };

    const offMessage = client.onMessage((message) => {
      if (!("sessionId" in message) || message.sessionId !== session.id) return;
      if (message.type === "attached") {
        terminal.reset();
        applySize(message.cols, message.rows);
        if (autoFit) autoFit.attached();
        else giveBackToggle(message.sizeOwner);
        gate.attached(message.replay, message.sequence);
      } else if (message.type === "data") {
        gate.data(message.data, message.sequence);
      } else if (message.type === "size") {
        applySize(message.cols, message.rows);
        if (autoFit) autoFit.owner(message.sizeOwner);
        else giveBackToggle(message.sizeOwner);
      }
    });
    const offState = client.onState((state) => {
      if (state !== "open") return;
      gate.reset();
      phoneSizeRef.current = false;
      setPhoneSize(false);
      client.send({ type: "attach", sessionId: session.id });
    });
    client.send({ type: "attach", sessionId: session.id });
    const input = terminal.onData((data) => client.send({ type: "write", sessionId: session.id, data }));

    // 터미널 영역이나 창 크기가 바뀌면 다시 맞춘다. 끄는 동안 연달아 오는 신호는 마지막에 한 번만 쓴다.
    // 둘을 구분한다: 영역은 스크롤바가 생기는 것만으로도 바뀌지만, 창 크기는 사용자가 바꾼 것이다.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let windowResized = false;
    const scheduleFit = () => {
      if (!autoFit) return;
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
    };
    const observer = autoFit && typeof ResizeObserver === "function" ? new ResizeObserver(scheduleFit) : null;
    observer?.observe(host);
    if (autoFit) window.addEventListener("resize", onWindowResize);

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
      const fullScreen = buffer.type === "alternate";
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
      observer?.disconnect();
      window.removeEventListener("resize", onWindowResize);
      if (resizeTimer) clearTimeout(resizeTimer);
      autoFitRef.current = null;
      host.removeEventListener("touchstart", onTouchStart);
      host.removeEventListener("touchmove", onTouchMove);
      host.removeEventListener("touchend", onTouchEnd);
      host.removeEventListener("touchcancel", onTouchEnd);
      if (phoneSizeRef.current) client.send({ type: "releaseSize", sessionId: session.id });
      client.send({ type: "detach", sessionId: session.id });
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [client, session.id, deviceId, wide]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) terminal.options.fontSize = FONT_SIZES[fontIndex];
    // 글자 크기가 바뀌면 같은 창에 들어가는 열·행 수가 달라진다.
    autoFitRef.current?.areaChanged();
  }, [fontIndex]);

  const togglePhoneSize = () => {
    const next = !phoneSizeRef.current;
    phoneSizeRef.current = next;
    setPhoneSize(next);
    if (!next) {
      client.send({ type: "releaseSize", sessionId: session.id });
      return;
    }
    const dims = fitRef.current?.proposeDimensions();
    if (dims && dims.cols >= 2 && dims.rows >= 1) {
      client.send({ type: "resize", sessionId: session.id, cols: dims.cols, rows: dims.rows });
    }
  };

  const sendKeys = (data: string) => client.send({ type: "write", sessionId: session.id, data });

  return (
    <main className="m-session-screen">
      <header className="m-bar">
        {wide ? null : (
          <button type="button" onClick={onBack} aria-label="세션 목록으로">
            ←
          </button>
        )}
        <h1>{session.label}</h1>
        <span className={`m-status m-status-${session.status}`}>{STATUS_LABEL[session.status]}</span>
      </header>
      <div className="m-tools">
        {wide ? (
          <>
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
          </>
        ) : (
          <button type="button" aria-pressed={phoneSize} onClick={togglePhoneSize}>
            📱 폰 크기로
          </button>
        )}
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
        {wide && fitState === "paused" ? (
          <span className="m-fit-notice" role="status">
            <button type="button" onClick={() => autoFitRef.current?.refit()}>
              다시 맞추기
            </button>
            <span>호스트가 크기를 가져갔습니다</span>
          </span>
        ) : null}
      </div>
      <div className="m-terminal" ref={hostRef} role="region" aria-label={`${session.label} 터미널`} />
      {toolsOpen ? (
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
