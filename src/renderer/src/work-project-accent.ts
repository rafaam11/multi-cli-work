import type { ProjectStatus } from "@shared/project-types";

/**
 * Every work project carries a 구분 (category), and the sidebar colours the whole group by it so a
 * folder's kind of work is readable at a glance. `WorkProject.category` is a free-form string —
 * only a handful of values are suggested (see WORK_PROJECT_CATEGORIES) — so the mapping to a colour has to
 * tolerate anything, and it lands on an ASCII slug rather than the Korean text itself: class
 * selectors then need no escaping, and a custom category adds no new class.
 *
 * The colours live in index.css keyed by these classes, the same one-place mapping the session
 * status colours use via --session-accent.
 */
export type WorkProjectAccent = "government" | "outsourcing" | "research" | "product" | "etc";

const CATEGORY_ACCENTS: Record<string, WorkProjectAccent> = {
  정부지원과제: "government",
  외주개발: "outsourcing",
  연구: "research",
  상품개발: "product",
  기타: "etc",
};

/** Anything outside the suggested categories reads as 기타 — grey, not a missing colour. */
export function categoryAccentClass(category: string): string {
  return `category-${CATEGORY_ACCENTS[category.trim()] ?? "etc"}`;
}

/**
 * Finished work should not compete with live work for attention, so the sidebar and the home
 * dashboard both dim these groups. One predicate so the two screens cannot drift apart.
 */
export function isWorkProjectDormant(status: ProjectStatus | null): boolean {
  return status === "완료" || status === "보관";
}

/**
 * ws-root 채널의 색. 채널은 업무 프로젝트의 상위 묶음이라 같은 팔레트를 쓰는 편이 읽기 쉽다 —
 * 새 토큰을 만들면 사이드바 한 화면에 색 계열이 둘이 되고, 그러면 색이 뜻하는 바가 흐려진다.
 * 매핑은 루트 CLAUDE.md §1의 채널 어휘 그대로다: G 과제 · O 용역 · R 연구 · Z 기타 · P 개인.
 */
export type ChannelAccent = "grant" | "service" | "research" | "personal" | "etc";

const CHANNEL_ACCENTS: Record<string, ChannelAccent> = {
  G: "grant",
  O: "service",
  R: "research",
  P: "personal",
  Z: "etc",
};

/** 규약 밖 글자는 기타로 — 색이 없는 것보다 회색이 낫다. */
export function channelAccentClass(letter: string): string {
  return `channel-${CHANNEL_ACCENTS[letter.trim().toUpperCase()] ?? "etc"}`;
}
