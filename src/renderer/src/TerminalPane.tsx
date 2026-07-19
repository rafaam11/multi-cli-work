import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { TerminalSessionView } from "@shared/api-types";
import { useEffect, useRef, useState } from "react";
import { droppedPathsAsPromptText } from "./drop-paths";
import "@xterm/xterm/css/xterm.css";

interface TerminalPaneProps {
  session: TerminalSessionView;
  onAttached(session: TerminalSessionView): void;
  onError(message: string): void;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isReadOnly(session: TerminalSessionView): boolean {
  return session.status === "exited" || session.status === "error";
}

export function TerminalPane({ session, onAttached, onError }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef(session);
  const onAttachedRef = useRef(onAttached);
  const onErrorRef = useRef(onError);
  const scheduleResizeRef = useRef<() => void>(() => undefined);
  const [attaching, setAttaching] = useState(true);
  const readOnly = isReadOnly(session);

  sessionRef.current = session;
  onAttachedRef.current = onAttached;
  onErrorRef.current = onError;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let replayAttached = false;
    let resizeTimer: number | undefined;
    const pendingOutput: Array<{ data: string; sequence: number }> = [];
    const terminal = new Terminal({
      allowTransparency: false,
      cursorBlink: false,
      cursorStyle: "bar",
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 10_000,
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
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);

    const reportError = (error: unknown) => {
      if (!disposed) onErrorRef.current(getErrorMessage(error));
    };

    terminal.attachCustomKeyEventHandler((event) => {
      if (!event.ctrlKey || !event.shiftKey) return true;
      const key = event.code || event.key;
      if (key !== "KeyC" && key !== "KeyV") return true;
      if (event.type !== "keydown") return false;
      event.preventDefault();

      if (key === "KeyC") {
        const selection = terminal.getSelection();
        if (selection) void navigator.clipboard.writeText(selection).catch(reportError);
      } else if (!isReadOnly(sessionRef.current)) {
        void navigator.clipboard
          .readText()
          .then((text) => {
            if (!disposed && text && !isReadOnly(sessionRef.current)) {
              terminal.paste(text);
            }
          })
          .catch(reportError);
      }
      return false;
    });

    const resize = () => {
      if (disposed || isReadOnly(sessionRef.current)) return;
      try {
        fitAddon.fit();
        if (terminal.cols > 0 && terminal.rows > 0) {
          void window.multiCliWork.terminals
            .resize(session.id, terminal.cols, terminal.rows)
            .catch(reportError);
        }
      } catch (error) {
        reportError(error);
      }
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
    host.addEventListener("dragover", handleDragOver);
    host.addEventListener("drop", handleDrop);
    const unsubscribe = window.multiCliWork.terminals.onEvent((event) => {
      if (event.sessionId !== session.id || event.type !== "data") return;
      if (replayAttached) terminal.write(event.data);
      else pendingOutput.push({ data: event.data, sequence: event.sequence });
    });
    const resizeObserver = new ResizeObserver(scheduleResize);
    resizeObserver.observe(host);

    void window.multiCliWork.terminals
      .attach(session.id)
      .then((attachment) => {
        if (disposed) return;
        terminal.write(attachment.replay);
        replayAttached = true;
        for (const output of pendingOutput) {
          if (output.sequence > attachment.sequence) terminal.write(output.data);
        }
        pendingOutput.length = 0;
        onAttachedRef.current(attachment.session);
        setAttaching(false);
        scheduleResize();
        terminal.focus();
      })
      .catch((error) => {
        setAttaching(false);
        reportError(error);
      });

    return () => {
      disposed = true;
      window.clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      host.removeEventListener("dragover", handleDragOver);
      host.removeEventListener("drop", handleDrop);
      unsubscribe();
      inputDisposable.dispose();
      fitAddon.dispose();
      terminal.dispose();
      scheduleResizeRef.current = () => undefined;
    };
  }, [session.id]);

  useEffect(() => {
    if (!readOnly) scheduleResizeRef.current();
  }, [readOnly]);

  return (
    <section className="terminal-surface" aria-label={`${session.kind} 터미널`}>
      <div className="terminal-host" ref={hostRef} />
      {attaching ? <span className="terminal-progress">세션 연결 중</span> : null}
    </section>
  );
}
