/** fitting: 이 창 크기로 맞추는 중 · paused: 호스트가 크기를 되찾아 멈춤 · host: 호스트 크기 유지를 골랐다. */
export type AutoFitState = "fitting" | "paused" | "host";

export interface AutoFitOptions {
  deviceId: string;
  /** 지금 터미널 영역에 들어가는 크기. 아직 잴 수 없으면 null. */
  measure(): { cols: number; rows: number } | null;
  resize(cols: number, rows: number): void;
  release(): void;
  onChange(state: AutoFitState): void;
}

/**
 * 넓은 화면에서 PTY 크기를 이 창에 맞추는 규칙. PTY 크기는 하나뿐이고 호스트 데스크톱이 입력하거나
 * 패인 크기를 바꾸면 되찾아 간다. 그때 곧바로 다시 resize를 보내면 호스트와 번갈아 크기를 바꾸게
 * 되므로, 되찾기를 보면 멈추고 사용자가 창 크기를 바꾸거나 "다시 맞추기"를 누를 때만 다시 맞춘다.
 */
export function createAutoFit(options: AutoFitOptions) {
  let state: AutoFitState = "fitting";
  let attachedOnce = false;
  let sent: { cols: number; rows: number } | null = null;

  const set = (next: AutoFitState) => {
    if (state === next) return;
    state = next;
    options.onChange(next);
  };

  const fit = (force: boolean) => {
    const size = options.measure();
    if (!size || size.cols < 2 || size.rows < 1) return;
    if (!force && sent && sent.cols === size.cols && sent.rows === size.rows) return;
    sent = size;
    options.resize(size.cols, size.rows);
  };

  return {
    state: () => state,

    /** attach 응답을 받았다(재연결 포함). resize는 붙은 세션에만 통한다. */
    attached() {
      attachedOnce = true;
      if (state === "host") return;
      set("fitting");
      fit(true);
    },

    /** 호스트가 알려 온 크기 소유자. 맞추는 중인데 내가 아니면 호스트가 되찾은 것이다. */
    owner(owner: string) {
      if (state !== "fitting" || owner === options.deviceId) return;
      sent = null;
      set("paused");
    },

    /** 터미널 영역의 크기가 바뀌었다 — 창 크기 변경. 멈춰 있었다면 다시 맞춘다. */
    viewportChanged() {
      if (!attachedOnce || state === "host") return;
      const resumed = state === "paused";
      set("fitting");
      fit(resumed);
    },

    refit() {
      if (!attachedOnce) return;
      set("fitting");
      fit(true);
    },

    keepHost(on: boolean) {
      if (on) {
        sent = null;
        set("host");
        options.release();
        return;
      }
      set("fitting");
      if (attachedOnce) fit(true);
    },
  };
}

export type AutoFit = ReturnType<typeof createAutoFit>;
