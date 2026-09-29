import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import type { RemoteSessionSummary } from "@shared/remote-types";
import type { RemoteClient } from "./remote-client";
import { STATUS_LABEL } from "./SessionList";
import { createReplayGate, encodeComposerInput, QUICK_KEYS } from "./terminal-input";

interface SessionScreenProps {
  client: RemoteClient;
  session: RemoteSessionSummary;
  deviceId: string;
  onBack(): void;
}

const FONT_SIZES = [9, 10, 11, 12, 13, 14, 16] as const;

/**
 * 폰의 세션 화면. 기본은 PC의 열 수를 그대로 그리고 가로로 스크롤한다. "폰 크기로"를 켜면 이 화면
 * 폭으로 PTY를 줄이고, PC가 크기를 되찾으면(입력·패인 크기 변경) 저절로 꺼진다.
 */
export function SessionScreen({ client, session, deviceId, onBack }: SessionScreenProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const phoneSizeRef = useRef(false);
  const [phoneSize, setPhoneSize] = useState(false);
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
        giveBackToggle(message.sizeOwner);
        gate.attached(message.replay, message.sequence);
      } else if (message.type === "data") {
        gate.data(message.data, message.sequence);
      } else if (message.type === "size") {
        applySize(message.cols, message.rows);
        giveBackToggle(message.sizeOwner);
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

    return () => {
      offMessage();
      offState();
      input.dispose();
      if (phoneSizeRef.current) client.send({ type: "releaseSize", sessionId: session.id });
      client.send({ type: "detach", sessionId: session.id });
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [client, session.id, deviceId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) terminal.options.fontSize = FONT_SIZES[fontIndex];
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
        <button type="button" onClick={onBack} aria-label="세션 목록으로">
          ←
        </button>
        <h1>{session.label}</h1>
        <span className={`m-status m-status-${session.status}`}>{STATUS_LABEL[session.status]}</span>
      </header>
      <div className="m-tools">
        <button type="button" aria-pressed={phoneSize} onClick={togglePhoneSize}>
          📱 폰 크기로
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
      </div>
      <div className="m-terminal" ref={hostRef} role="region" aria-label={`${session.label} 터미널`} />
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
    </main>
  );
}
