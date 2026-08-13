import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { TerminalSessionView } from "@shared/api-types";
import type { TerminalSettings } from "@shared/settings-types";
import { useEffect, useRef, useState } from "react";
import { droppedPathsAsPromptText } from "./drop-paths";
import { createTerminalOutputFilter } from "./terminal-output-filter";
import "@xterm/xterm/css/xterm.css";

/**
 * What the title bar's 편집 menu can do to a live terminal. The pane owns the xterm instance, so the
 * menu cannot reach into it directly — it gets these handles instead.
 */
export interface TerminalCommands {
  copySelection(): void;
  paste(): void;
  selectAll(): void;
  clear(): void;
  focus(): void;
}

interface TerminalPaneProps {
  session: TerminalSessionView;
  settings: TerminalSettings;
  /** Bytes to send instead of a plain Enter when Shift is held. Null keeps xterm's own handling. */
  shiftEnterBytes: string | null;
  refreshRequest: number;
  onAttached(session: TerminalSessionView): void;
  onRefreshComplete(sessionId: string): void;
  onError(message: string): void;
  /**
   * Whether this pane grabs the keyboard once it has attached. With a grid of panes attaching at
   * once, only the focused one may — the rest would each steal the keyboard as they finish.
   */
  autoFocus?: boolean;
  /** Publishes this pane's command handles; called with null once the terminal is gone. */
  onRegisterCommands?(sessionId: string, commands: TerminalCommands | null): void;
  /** In a grid there is no "active pane" — the last terminal to take the keyboard is the target. */
  onTerminalFocused?(sessionId: string): void;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isReadOnly(session: TerminalSessionView): boolean {
  return session.status === "exited" || session.status === "error";
}

export function TerminalPane({
  session,
  settings,
  shiftEnterBytes,
  refreshRequest,
  autoFocus = true,
  onAttached,
  onRefreshComplete,
  onError,
  onRegisterCommands,
  onTerminalFocused,
}: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef(session);
  const settingsRef = useRef(settings);
  const shiftEnterRef = useRef(shiftEnterBytes);
  const onAttachedRef = useRef(onAttached);
  const onRefreshCompleteRef = useRef(onRefreshComplete);
  const onErrorRef = useRef(onError);
  const onRegisterCommandsRef = useRef(onRegisterCommands);
  const onTerminalFocusedRef = useRef(onTerminalFocused);
  const autoFocusRef = useRef(autoFocus);
  const lastRefreshRequestRef = useRef(refreshRequest);
  const scheduleResizeRef = useRef<() => void>(() => undefined);
  const refitRef = useRef<() => void>(() => undefined);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const [attaching, setAttaching] = useState(true);
  const readOnly = isReadOnly(session);

  sessionRef.current = session;
  settingsRef.current = settings;
  shiftEnterRef.current = shiftEnterBytes;
  onAttachedRef.current = onAttached;
  onRefreshCompleteRef.current = onRefreshComplete;
  onErrorRef.current = onError;
  onRegisterCommandsRef.current = onRegisterCommands;
  onTerminalFocusedRef.current = onTerminalFocused;
  autoFocusRef.current = autoFocus;

  useEffect(() => {
    const host = hostRef.current;
    const frame = frameRef.current;
    if (!host || !frame) return;
    const refreshing = refreshRequest !== lastRefreshRequestRef.current;
    lastRefreshRequestRef.current = refreshRequest;
    setAttaching(true);

    let disposed = false;
    let refreshCompleted = false;
    let replayAttached = false;
    let resizeTimer: number | undefined;
    const pendingOutput: Array<{ data: string; sequence: number }> = [];
    const outputFilter = createTerminalOutputFilter();
    const reportError = (error: unknown) => {
      if (!disposed) onErrorRef.current(getErrorMessage(error));
    };
    const terminal = new Terminal({
      allowTransparency: false,
      cursorBlink: settingsRef.current.cursorBlink,
      cursorStyle: settingsRef.current.cursorStyle,
      fontFamily: settingsRef.current.fontFamily,
      fontSize: settingsRef.current.fontSize,
      lineHeight: settingsRef.current.lineHeight,
      // Without a handler, xterm confirms the click and then calls window.open(), which
      // secureBrowserWindow() denies, so the link never opens. Hand the URL to the OS browser
      // through the main process instead. allowNonHttpProtocols stays off, so only http(s) links
      // are linkified at all, and the main process validates the scheme again.
      linkHandler: {
        activate: (_event, uri) => {
          void window.multiCliWork.shell.openExternal(uri).catch(reportError);
        },
      },
      scrollback: settingsRef.current.scrollback,
      theme: {
        background: "#161918",
        foreground: "#dfe5e1",
        cursor: "#4fb7a4",
        cursorAccent: "#161918",
        selectionBackground: "#355e56",
        black: "#202524",
        red: "#d46a6a",
        green: "#73b987",
        yellow: "#d8a24a",
        blue: "#6ea8d8",
        magenta: "#aa8ccc",
        cyan: "#4fb7a4",
        white: "#dfe5e1",
        brightBlack: "#69736e",
        brightRed: "#e78383",
        brightGreen: "#91cea0",
        brightYellow: "#e8ba6d",
        brightBlue: "#8abbe3",
        brightMagenta: "#bea2d2",
        brightCyan: "#78caba",
        brightWhite: "#ffffff",
      },
    });
    terminalInstanceRef.current = terminal;
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    // Opened in the inset frame, not the host: FitAddon sizes the grid from this parent's border
    // box, so the parent has to be exactly the area xterm is allowed to paint. The host stays
    // full-bleed and keeps owning the drag-and-drop and focus listeners below.
    terminal.open(frame);

    const writeOutput = (data: string) => {
      const filtered = outputFilter.write(data);
      if (filtered) terminal.write(filtered);
    };
    const finishRefresh = () => {
      if (!refreshing || refreshCompleted) return;
      refreshCompleted = true;
      onRefreshCompleteRef.current(session.id);
    };

    // The keyboard shortcuts and the 편집 menu run the very same two functions, so a change to
    // either path can never leave the other behaving differently.
    const copySelection = () => {
      const selection = terminal.getSelection();
      if (!selection) return;
      void window.multiCliWork.clipboard.writeText(selection).catch(reportError);
    };
    const pasteFromClipboard = () => {
      if (isReadOnly(sessionRef.current)) return;
      void window.multiCliWork.clipboard
        .readText()
        .then((text) => {
          if (!disposed && text && !isReadOnly(sessionRef.current)) {
            terminal.paste(text);
          }
        })
        .catch(reportError);
    };

    terminal.attachCustomKeyEventHandler((event) => {
      // Shift+Enter reaches xterm as a plain Enter, so a CLI that wants a newline there never sees
      // one. Agents that name a substitute get it written straight to the PTY instead.
      if (event.key === "Enter" && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
        const bytes = shiftEnterRef.current;
        if (bytes === null) return true;
        event.preventDefault();
        if (event.type === "keydown" && !isReadOnly(sessionRef.current)) {
          void window.multiCliWork.terminals.write(session.id, bytes).catch(reportError);
        }
        return false;
      }
      if (!event.ctrlKey || event.altKey) return true;
      const key = event.code || event.key;
      if (key !== "KeyC" && key !== "KeyV") return true;
      if (event.type !== "keydown") return false;
      if (key === "KeyC") {
        if (!terminal.getSelection()) {
          // Plain Ctrl+C is the terminal interrupt. Ctrl+Shift+C is still consumed as the
          // explicit copy shortcut, even if there is nothing to copy.
          if (!event.shiftKey) return true;
          event.preventDefault();
          return false;
        }
        event.preventDefault();
        copySelection();
      } else {
        event.preventDefault();
        pasteFromClipboard();
      }
      return false;
    });

    onRegisterCommandsRef.current?.(session.id, {
      copySelection,
      paste: pasteFromClipboard,
      selectAll: () => terminal.selectAll(),
      clear: () => terminal.clear(),
      focus: () => terminal.focus(),
    });

    const resize = () => {
      if (disposed) return;
      try {
        fitAddon.fit();
        if (!isReadOnly(sessionRef.current) && terminal.cols > 0 && terminal.rows > 0) {
          void window.multiCliWork.terminals
            .resize(session.id, terminal.cols, terminal.rows)
            .catch(reportError);
        }
      } catch (error) {
        reportError(error);
      }
    };

    refitRef.current = () => {
      resize();
    };

    const scheduleResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 40);
    };
    scheduleResizeRef.current = scheduleResize;

    const inputDisposable = terminal.onData((data) => {
      if (isReadOnly(sessionRef.current)) return;
      void window.multiCliWork.terminals.write(session.id, data).catch(reportError);
    });

    // A dropped file arrives as its quoted path on the prompt. paste() (rather than a direct
    // write) keeps it inside bracketed paste, so a CLI sees one pasted chunk, not typed keys.
    const handleDragOver = (event: DragEvent) => {
      if (isReadOnly(sessionRef.current)) return;
      if (!event.dataTransfer || ![...event.dataTransfer.types].includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    };
    const handleDrop = (event: DragEvent) => {
      if (isReadOnly(sessionRef.current) || !event.dataTransfer) return;
      const text = droppedPathsAsPromptText(
        [...event.dataTransfer.files].map((file) => window.multiCliWork.files.pathFor(file)),
      );
      if (text === null) return;
      event.preventDefault();
      terminal.paste(text);
      terminal.focus();
    };
    // xterm keeps the keyboard on a hidden textarea inside the host, so its focus is the only
    // reliable signal that this pane — rather than the other half of a split — is the live one.
    const handleFocusIn = () => onTerminalFocusedRef.current?.(session.id);
    host.addEventListener("dragover", handleDragOver);
    host.addEventListener("drop", handleDrop);
    host.addEventListener("focusin", handleFocusIn);
    const unsubscribe = window.multiCliWork.terminals.onEvent((event) => {
      if (event.sessionId !== session.id || event.type !== "data") return;
      if (replayAttached) writeOutput(event.data);
      else pendingOutput.push({ data: event.data, sequence: event.sequence });
    });
    const resizeObserver = new ResizeObserver(scheduleResize);
    resizeObserver.observe(frame);

    // The replay is the PTY's own output, stored at the width the PTY wrote it. A terminal still on
    // xterm's 80x24 default re-wraps every one of those lines — padded ones fold into blank lines —
    // and the later fit cannot fully undo it. Size this terminal, and the PTY, before asking for it.
    resize();

    // resize() just fitted the terminal, so these are the pane's real dimensions. An attach that
    // lazily resumes a session interrupted by shutdown spawns its PTY at this size — the renderer's
    // own resize cannot do it, because the session is still `exited` when this runs and the
    // coordinator drops a resize for a session with no process.
    const size = terminal.cols > 0 && terminal.rows > 0 ? { cols: terminal.cols, rows: terminal.rows } : undefined;
    const attachment = refreshing
      ? window.multiCliWork.terminals.refresh(session.id)
      : window.multiCliWork.terminals.attach(session.id, size);
    void attachment
      .then((attachment) => {
        if (disposed) return;
        writeOutput(attachment.replay);
        replayAttached = true;
        for (const output of pendingOutput) {
          if (output.sequence > attachment.sequence) writeOutput(output.data);
        }
        pendingOutput.length = 0;
        onAttachedRef.current(attachment.session);
        setAttaching(false);
        scheduleResize();
        if (autoFocusRef.current) terminal.focus();
        finishRefresh();
      })
      .catch((error) => {
        if (!disposed) setAttaching(false);
        reportError(error);
        finishRefresh();
      });

    return () => {
      disposed = true;
      window.clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      host.removeEventListener("dragover", handleDragOver);
      host.removeEventListener("drop", handleDrop);
      host.removeEventListener("focusin", handleFocusIn);
      onRegisterCommandsRef.current?.(session.id, null);
      unsubscribe();
      inputDisposable.dispose();
      fitAddon.dispose();
      terminal.dispose();
      scheduleResizeRef.current = () => undefined;
      terminalInstanceRef.current = null;
      refitRef.current = () => undefined;
      finishRefresh();
    };
  }, [session.id, refreshRequest]);

  useEffect(() => {
    if (!readOnly) scheduleResizeRef.current();
  }, [readOnly]);

  // xterm 6은 options를 런타임에 바꿀 수 있다 — 인스턴스를 살려둔 채 반영해야 스크롤백이 산다.
  useEffect(() => {
    const terminal = terminalInstanceRef.current;
    if (!terminal) return;
    terminal.options.fontFamily = settings.fontFamily;
    terminal.options.fontSize = settings.fontSize;
    terminal.options.lineHeight = settings.lineHeight;
    terminal.options.scrollback = settings.scrollback;
    terminal.options.cursorStyle = settings.cursorStyle;
    terminal.options.cursorBlink = settings.cursorBlink;
    refitRef.current(); // 폰트 크기가 곧 셀 크기 — 그리드를 다시 맞춘다
  }, [settings]);

  return (
    <section className="terminal-surface" aria-label={`${session.kind} 터미널`}>
      <div className="terminal-host" ref={hostRef}>
        <div className="terminal-frame" ref={frameRef} />
      </div>
      {attaching ? <span className="terminal-progress">세션 연결 중</span> : null}
    </section>
  );
}
