/**
 * 태그와 구분이 함께 쓰는 팔레트. 한 화면에 색 계열이 둘이면 색이 무엇을 뜻하는지 흐려진다 —
 * 채널 색이 구분 팔레트를 다시 쓴 것과 같은 이유다. shared에 사는 것은 설정 파서(1..7 검증)와
 * 렌더러(클래스 이름) 둘 다 이 숫자를 알아야 하기 때문이다.
 */
export const ACCENT_COLOR_COUNT = 7;
export const ACCENT_INDEXES: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

/** 1..7 → CSS 클래스. 범위 밖은 1로 접는다 — 파서가 이미 막으므로 여기는 마지막 그물이다. */
export function accentClass(index: number): string {
  const safe = Number.isInteger(index) && index >= 1 && index <= ACCENT_COLOR_COUNT ? index : 1;
  return `accent-${safe}`;
}
