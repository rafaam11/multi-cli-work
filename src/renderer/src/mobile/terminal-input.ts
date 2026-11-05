/** 폰 키보드에 없는 키. 1·2·3은 CLI의 승인 선택지, /는 슬래시 명령이다. */
export const QUICK_KEYS: ReadonlyArray<{ label: string; ariaLabel: string; data: string }> = [
  { label: "Esc", ariaLabel: "Esc", data: "\x1b" },
  { label: "Tab", ariaLabel: "Tab", data: "\t" },
  { label: "←", ariaLabel: "왼쪽 화살표", data: "\x1b[D" },
  { label: "→", ariaLabel: "오른쪽 화살표", data: "\x1b[C" },
  { label: "↑", ariaLabel: "위 화살표", data: "\x1b[A" },
  { label: "↓", ariaLabel: "아래 화살표", data: "\x1b[B" },
  { label: "Enter", ariaLabel: "Enter", data: "\r" },
  { label: "^C", ariaLabel: "Ctrl+C", data: "\x03" },
  { label: "1", ariaLabel: "1", data: "1" },
  { label: "2", ariaLabel: "2", data: "2" },
  { label: "3", ariaLabel: "3", data: "3" },
  { label: "/", ariaLabel: "슬래시", data: "/" },
];

export type QuickKey = (typeof QUICK_KEYS)[number];

const key = (label: string) => QUICK_KEYS.find((candidate) => candidate.label === label)!;

/** 폰 키 줄: 자주 누르는 것부터. 화면 폭을 넘치면 옆으로 민다. */
const PHONE_ORDER = ["Esc", "↑", "↓", "Enter", "Tab", "^C", "1", "2", "3", "←", "→", "/"].map(key);
/** 승인을 기다리면 답할 키(1·2·3·Esc)를 앞으로 당긴다 — 키 줄을 접어 둔 낮은 화면에서도 이것만은 남는다. */
const APPROVAL_FIRST = ["1", "2", "3", "Esc"].map(key);

export interface PhoneKey extends QuickKey {
  /** 지금 상태에서 답하는 데 쓰는 키. */
  hot: boolean;
}

export function phoneQuickKeys(approval: boolean): PhoneKey[] {
  if (!approval) return PHONE_ORDER.map((item) => ({ ...item, hot: false }));
  return [
    ...APPROVAL_FIRST.map((item) => ({ ...item, hot: true })),
    ...PHONE_ORDER.filter((item) => !APPROVAL_FIRST.includes(item)).map((item) => ({ ...item, hot: false })),
  ];
}

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
export function createReplayGate(write: (data: string) => void, writeReplay = write) {
  let lastSequence: number | null = null;
  const pending: Array<{ data: string; sequence: number }> = [];
  return {
    reset() {
      lastSequence = null;
      pending.length = 0;
    },
    attached(replay: string, sequence: number) {
      writeReplay(replay);
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

export type ClipboardKeyAction = "copy" | "paste" | "swallow" | null;

/**
 * 데스크톱 TerminalPane과 같은 키 규칙. Ctrl+C는 선택이 있을 때만 복사이고(없으면 인터럽트로 PTY에
 * 간다), Ctrl+Shift+C는 복사할 것이 없어도 복사 키로 먹는다. Ctrl+V·Ctrl+Shift+V는 붙여넣기다.
 */
export function clipboardKeyAction(
  event: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "code" | "key">,
  hasSelection: boolean,
): ClipboardKeyAction {
  if (!event.ctrlKey || event.altKey || event.metaKey) return null;
  const key = event.code || event.key;
  if (key === "KeyV") return "paste";
  if (key !== "KeyC") return null;
  if (hasSelection) return "copy";
  return event.shiftKey ? "swallow" : null;
}
