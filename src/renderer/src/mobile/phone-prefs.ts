/**
 * 이 기기의 화면 취향. 호스트와 나누지 않고 기기(브라우저 저장소)에만 둔다 — 같은 PC를 폰과 태블릿으로
 * 볼 때 각자 다를 수 있다.
 */
export const PHONE_PREFS = {
  /** 켜면 터미널을 이 화면에 맞추지 않고 PC 열 수 그대로 그린다(옆으로 밀어 본다). */
  keepHostSize: "mcw.remote.keepHostSize.v1",
  /** 높이가 낮을 때(키보드가 열렸을 때) 접어 두는 키 줄을 펼쳐 둘지. */
  keysOpenWhenLow: "mcw.remote.keysOpenWhenLow.v1",
  /** 레일을 아이콘 폭으로 접어 둘지. */
  railCollapsed: "mcw.remote.railCollapsed.v1",
} as const;

export type PhonePref = keyof typeof PHONE_PREFS;

export function loadPhonePref(name: PhonePref): boolean {
  try {
    return window.localStorage.getItem(PHONE_PREFS[name]) === "1";
  } catch {
    return false;
  }
}

export function savePhonePref(name: PhonePref, value: boolean): void {
  try {
    window.localStorage.setItem(PHONE_PREFS[name], value ? "1" : "0");
  } catch {
    /* unavailable storage */
  }
}
