/** fitting: 이 창 크기로 맞추는 중 · paused: 호스트가 크기를 되찾아 멈춤 · host: 호스트 크기 유지를 골랐다. */
export type AutoFitState = "fitting" | "paused" | "host";

interface Size {
  cols: number;
  rows: number;
}

export interface AutoFitOptions {
  deviceId: string;
  /** 지금 터미널 영역에 들어가는 크기. 아직 잴 수 없으면 null. */
  measure(): Size | null;
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
  /** 마지막으로 보낸 크기. 맞추는 중에 같은 크기를 되풀이해 보내지 않으려고 둔다. */
  let lastFit: Size | null = null;

  const set = (next: AutoFitState) => {
    if (state === next) return;
    state = next;
    options.onChange(next);
  };

  const measure = (): Size | null => {
    const size = options.measure();
    return size && size.cols >= 2 && size.rows >= 1 ? size : null;
  };

  const send = (size: Size) => {
    lastFit = size;
    options.resize(size.cols, size.rows);
  };

  return {
    state: () => state,

    /** attach 응답을 받았다(재연결 포함). resize는 붙은 세션에만 통한다. */
    attached() {
      attachedOnce = true;
      // 멈춤(호스트가 되찾음)과 호스트 크기 유지는 재연결로 풀리지 않는다.
      if (state !== "fitting") return;
      const size = measure();
      if (size) send(size);
    },

    /** 호스트가 알려 온 크기 소유자. 맞추는 중인데 내가 아니면 호스트가 되찾은 것이다. */
    owner(owner: string) {
      if (state !== "fitting" || owner === options.deviceId) return;
      set("paused");
    },

    /**
     * 터미널 영역의 크기가 달라졌다(ResizeObserver, 글자 크기). 맞추는 중일 때만 따라간다. 멈춘 동안
     * 에는 따라가지 않는다 — 호스트 크기로 그려진 터미널이 이 창을 넘치면 스크롤바가 생기고, 그것만
     * 으로도 영역과 들어가는 열·행 수가 달라져서, 사용자가 아무것도 안 했는데 크기를 도로 가져가게 된다.
     */
    areaChanged() {
      if (!attachedOnce || state !== "fitting") return;
      const size = measure();
      if (!size) return;
      if (lastFit && lastFit.cols === size.cols && lastFit.rows === size.rows) return;
      send(size);
    },

    /** 사용자가 창 크기를 바꿨다. 멈춰 있었다면 이것이 다시 맞추라는 뜻이다. */
    windowResized() {
      if (!attachedOnce || state === "host") return;
      const size = measure();
      if (!size) return;
      if (state === "fitting" && lastFit && lastFit.cols === size.cols && lastFit.rows === size.rows) return;
      set("fitting");
      send(size);
    },

    refit() {
      if (!attachedOnce) return;
      const size = measure();
      if (!size) return;
      set("fitting");
      send(size);
    },

    keepHost(on: boolean) {
      if (on) {
        set("host");
        options.release();
        return;
      }
      set("fitting");
      if (!attachedOnce) return;
      const size = measure();
      if (size) send(size);
    },
  };
}

export type AutoFit = ReturnType<typeof createAutoFit>;
