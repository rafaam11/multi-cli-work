import { ACCENT_COLOR_COUNT, accentClass } from "@shared/accent-palette";

/**
 * 태그 색은 뜻이 아니라 구별 표시다 — 자유 문자열에 의미론적 이름을 붙일 수 없으므로 클래스도
 * 번호다. 팔레트는 구분과 같은 것이다(accent-palette.ts).
 */
export const TAG_ACCENT_COUNT = ACCENT_COLOR_COUNT;

/** FNV-1a — 로케일·플랫폼과 무관해야 같은 태그가 어느 화면에서나 같은 색이 된다. */
export function tagAccentIndex(tag: string): number {
  let hash = 0x811c9dc5;
  for (const char of tag.trim()) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash % TAG_ACCENT_COUNT) + 1;
}

export function tagAccentClass(tag: string): string {
  return accentClass(tagAccentIndex(tag));
}
