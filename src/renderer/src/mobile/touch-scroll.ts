export interface TouchScrollState {
  /** 터미널을 담은 틀(.m-terminal)의 현재 scrollTop과 최댓값. PC 크기로 그리면 틀이 넘친다. */
  containerTop: number;
  containerMax: number;
  /** xterm 버퍼의 보고 있는 줄과 맨 아래(라이브) 줄. */
  viewportY: number;
  baseY: number;
  /**
   * 전체 화면(alternate screen) 앱 — claude처럼 xterm 스크롤백 없이 휠 입력을 받아 스스로 스크롤한다.
   * 이때 lines는 스크롤백 줄이 아니라 앱에 보낼 휠 단계이고, 끝이 없다.
   */
  unbounded?: boolean;
}

export interface TouchScrollStep {
  containerDelta: number;
  /** terminal.scrollLines에 넘길 값 — 음수면 지난 출력 쪽. */
  lines: number;
  /** 한 줄이 안 돼 다음 이동으로 넘기는 픽셀. */
  remainder: number;
}

/**
 * 세로 드래그 한 번(dy, 손가락이 아래로 가면 양수)을 어디에 쓸지 정한다. xterm은 손가락 드래그를
 * 스크롤백 이동으로 바꿔 주지 않아서 여기서 직접 한다. 과거 쪽으로는 넘친 틀을 먼저 위로 올리고
 * 그다음 스크롤백을, 현재 쪽으로는 스크롤백을 라이브까지 내린 다음 틀을 내린다.
 */
export function planTouchScroll(state: TouchScrollState, dy: number, cellHeight: number, carry: number): TouchScrollStep {
  const total = carry + dy;
  if (state.unbounded) return planUnbounded(state, total, cellHeight);
  if (total > 0) {
    const containerUse = Math.min(total, state.containerTop);
    const rest = total - containerUse;
    const wanted = Math.floor(rest / cellHeight);
    const n = Math.min(wanted, state.viewportY);
    return {
      containerDelta: containerUse === 0 ? 0 : -containerUse,
      lines: n === 0 ? 0 : -n,
      remainder: n < wanted ? 0 : rest - n * cellHeight,
    };
  }
  if (total < 0) {
    const distance = -total;
    const wanted = Math.floor(distance / cellHeight);
    const n = Math.min(wanted, state.baseY - state.viewportY);
    const rest = distance - n * cellHeight;
    if (n < wanted || state.viewportY + n >= state.baseY) {
      // 라이브 줄에 닿았다 — 남은 이동은 넘친 틀을 아래로 내리는 데 쓴다.
      return { containerDelta: Math.min(rest, state.containerMax - state.containerTop), lines: n, remainder: 0 };
    }
    return { containerDelta: 0, lines: n, remainder: rest === 0 ? 0 : -rest };
  }
  return { containerDelta: 0, lines: 0, remainder: 0 };
}

/** 넘친 틀을 양방향 모두 먼저 움직이고, 남은 거리는 휠 단계로 바꾼다. */
function planUnbounded(state: TouchScrollState, total: number, cellHeight: number): TouchScrollStep {
  if (total === 0) return { containerDelta: 0, lines: 0, remainder: 0 };
  const direction = total > 0 ? 1 : -1;
  const room = direction > 0 ? state.containerTop : state.containerMax - state.containerTop;
  const containerUse = Math.min(Math.abs(total), Math.max(0, room));
  const rest = Math.abs(total) - containerUse;
  const n = Math.floor(rest / cellHeight);
  const leftover = rest - n * cellHeight;
  return {
    containerDelta: containerUse === 0 ? 0 : -direction * containerUse,
    lines: n === 0 ? 0 : -direction * n,
    remainder: leftover === 0 ? 0 : direction * leftover,
  };
}
