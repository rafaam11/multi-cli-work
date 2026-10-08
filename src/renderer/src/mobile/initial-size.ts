/** 세션 화면의 글자 크기 단계. 처음은 TERMINAL_FONT_INDEX(12px)다. */
export const TERMINAL_FONT_SIZES = [9, 10, 11, 12, 13, 14, 16] as const;
export const TERMINAL_FONT_INDEX = 3;

export interface TerminalSize {
  cols: number;
  rows: number;
}

/** 세션 화면이 실제로 잰 크기와 그때의 배치. */
export interface MeasuredSize extends TerminalSize {
  wide: boolean;
}

// 어림에만 쓰는 화면 틀(mobile.css). 넓은 화면은 목록 280px + 경계 1px, 머리줄과 도구줄. 좁은 화면은
// 머리줄·도구줄에 빠른 키와 입력창까지. 터미널 틀의 좌우 여백은 4px씩.
const WIDE_LIST_PX = 281;
const TERMINAL_PADDING_PX = 8;
const CHROME_HEIGHT_PX = { wide: 112, narrow: 216 } as const;
// 고정폭 글꼴의 글자 폭은 대개 0.6em, xterm의 줄 높이는 1.2em 안팎이다.
const CELL_WIDTH_EM = 0.6;
const CELL_HEIGHT_EM = 1.2;

/**
 * 새 세션을 띄울 크기. 만드는 시점에는 그 세션의 터미널이 없으므로, 이 화면이 다른 세션을 열어 잰
 * 크기를 쓰고, 없으면 창 크기에서 어림한다. 어림이 조금 틀려도 넓은 화면은 붙자마자 다시 맞춘다.
 */
export function startSize(input: {
  measured: MeasuredSize | null;
  wide: boolean;
  viewport: { width: number; height: number };
}): TerminalSize | null {
  const { measured, wide, viewport } = input;
  if (measured && measured.wide === wide) return { cols: measured.cols, rows: measured.rows };
  const fontSize = TERMINAL_FONT_SIZES[TERMINAL_FONT_INDEX];
  const width = viewport.width - (wide ? WIDE_LIST_PX : 0) - TERMINAL_PADDING_PX;
  const height = viewport.height - CHROME_HEIGHT_PX[wide ? "wide" : "narrow"];
  const cols = Math.floor(width / (fontSize * CELL_WIDTH_EM));
  const rows = Math.floor(height / (fontSize * CELL_HEIGHT_EM));
  return cols >= 2 && rows >= 1 ? { cols, rows } : null;
}
