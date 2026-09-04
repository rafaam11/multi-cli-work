import { accentClass } from "@shared/accent-palette";
import type { ProjectStatus } from "@shared/project-types";
import type { ProjectCategorySetting } from "@shared/settings-types";

/**
 * 구분(category)은 사용자 정의 목록(설정 › 프로젝트)이고 `WorkProject.category`는 자유 문자열이라,
 * 색은 "지금 목록에서 그 이름을 찾았는가"로만 정해진다. 목록에서 사라졌거나 손으로 넣은 옛 값은
 * 회색(category-etc)으로 남는다 — 색이 빠진 게 아니라 "분류 밖"이라는 뜻의 색이다. 색은 index.css가
 * 클래스마다 --category-accent로 푼다(accent-1..7과 category-etc).
 *
 * 목록을 두 번째 인자로 강제하는 것은 목록을 안 넘긴 소비처가 조용히 전부 회색이 되지 않게 하려는
 * 것이다 — 빠뜨리면 typecheck가 잡는다.
 */
export function categoryAccentClass(category: string, categories: readonly ProjectCategorySetting[]): string {
  const key = category.trim();
  const found = categories.find((candidate) => candidate.name === key);
  return found ? accentClass(found.color) : "category-etc";
}

/**
 * Finished work should not compete with live work for attention, so the sidebar and the home
 * dashboard both dim these groups. One predicate so the two screens cannot drift apart.
 */
export function isWorkProjectDormant(status: ProjectStatus | null): boolean {
  return status === "완료" || status === "보관";
}
