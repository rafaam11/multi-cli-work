/** 폰 키보드에 없는 키. 1·2·3은 CLI의 승인 선택지, /는 슬래시 명령이다. */
export const QUICK_KEYS: ReadonlyArray<{ label: string; ariaLabel: string; data: string }> = [
  { label: "Esc", ariaLabel: "Esc", data: "\x1b" },
  { label: "Tab", ariaLabel: "Tab", data: "\t" },
  { label: "↑", ariaLabel: "위 화살표", data: "\x1b[A" },
  { label: "↓", ariaLabel: "아래 화살표", data: "\x1b[B" },
  { label: "Enter", ariaLabel: "Enter", data: "\r" },
  { label: "^C", ariaLabel: "Ctrl+C", data: "\x03" },
  { label: "1", ariaLabel: "1", data: "1" },
  { label: "2", ariaLabel: "2", data: "2" },
  { label: "3", ariaLabel: "3", data: "3" },
  { label: "/", ariaLabel: "슬래시", data: "/" },
];

/**
 * 입력창 내용을 PTY로 보낼 바이트로. 여러 줄은 bracketed paste로 감싸 CLI가 줄바꿈마다 제출하지
 * 않게 하고, 마지막에 Enter를 한 번 누른다.
 */
export function encodeComposerInput(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (!normalized.includes("\n")) return `${normalized}\r`;
  return `\x1b[200~${normalized.replace(/\n/g, "\r")}\x1b[201~\r`;
}

/**
 * replay와 실시간 출력을 이어 붙이는 문. attached 전의 출력은 모아 두었다가 replay 뒤에
 * sequence가 더 큰 것만 쓴다 — 데스크톱 TerminalPane과 같은 규칙.
 */
export function createReplayGate(write: (data: string) => void) {
  let lastSequence: number | null = null;
  const pending: Array<{ data: string; sequence: number }> = [];
  return {
    reset() {
      lastSequence = null;
      pending.length = 0;
    },
    attached(replay: string, sequence: number) {
      write(replay);
      lastSequence = sequence;
      for (const output of pending) {
        if (output.sequence > lastSequence) {
          write(output.data);
          lastSequence = output.sequence;
        }
      }
      pending.length = 0;
    },
    data(data: string, sequence: number) {
      if (lastSequence === null) {
        pending.push({ data, sequence });
        return;
      }
      if (sequence <= lastSequence) return;
      write(data);
      lastSequence = sequence;
    },
  };
}
