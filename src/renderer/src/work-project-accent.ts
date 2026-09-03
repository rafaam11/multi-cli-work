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
