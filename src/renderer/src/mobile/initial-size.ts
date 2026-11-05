/** 세션 화면의 글자 크기 단계. 처음은 TERMINAL_FONT_INDEX(12px)다. */
export const TERMINAL_FONT_SIZES = [9, 10, 11, 12, 13, 14, 16] as const;
export const TERMINAL_FONT_INDEX = 3;

export interface TerminalSize {
  cols: number;
  rows: number;
}

/** 넓은 화면(마우스·그리드) · 레일(폰 배치, 목록이 옆) · 좁음(폰 배치, 목록과 세션을 오감). */
export type ScreenLayout = "wide" | "rail" | "narrow";

/** 세션 화면이 실제로 잰 크기와 그때의 배치. */
export interface MeasuredSize extends TerminalSize {
  layout: ScreenLayout;
}

// 어림에만 쓰는 화면 틀(mobile.css·phone.css). 넓은 화면은 목록 280px + 경계 1px에 머리줄·도구줄. 레일은
// 목록이 clamp(184px, 27vw, 272px) + 경계 1px이고 아래 한 줄(키+입력). 좁음은 머리줄 하나와 아래 두 줄
// (키 줄·입력). 터미널 틀의 좌우 여백은 4px씩.
const WIDE_LIST_PX = 281;
const TERMINAL_PADDING_PX = 8;
const CHROME_HEIGHT_PX: Record<ScreenLayout, number> = { wide: 112, rail: 48, narrow: 130 };
// 고정폭 글꼴의 글자 폭은 대개 0.6em, xterm의 줄 높이는 1.2em 안팎이다.
const CELL_WIDTH_EM = 0.6;
const CELL_HEIGHT_EM = 1.2;

function listWidth(layout: ScreenLayout, viewportWidth: number): number {
  if (layout === "wide") return WIDE_LIST_PX;
  if (layout === "rail") return Math.min(272, Math.max(184, viewportWidth * 0.27)) + 1;
  return 0;
}

/**
 * 새 세션을 띄울 크기. 만드는 시점에는 그 세션의 터미널이 없으므로, 이 화면이 다른 세션을 열어 잰
 * 크기를 쓰고, 없으면 창 크기에서 어림한다. 어림이 조금 틀려도 붙자마자 다시 맞춘다.
 */
export function startSize(input: {
  measured: MeasuredSize | null;
  layout: ScreenLayout;
  viewport: { width: number; height: number };
}): TerminalSize | null {
  const { measured, layout, viewport } = input;
  if (measured && measured.layout === layout) return { cols: measured.cols, rows: measured.rows };
  const fontSize = TERMINAL_FONT_SIZES[TERMINAL_FONT_INDEX];
  const width = viewport.width - listWidth(layout, viewport.width) - TERMINAL_PADDING_PX;
  const height = viewport.height - CHROME_HEIGHT_PX[layout];
  const cols = Math.floor(width / (fontSize * CELL_WIDTH_EM));
  const rows = Math.floor(height / (fontSize * CELL_HEIGHT_EM));
  return cols >= 2 && rows >= 1 ? { cols, rows } : null;
}
