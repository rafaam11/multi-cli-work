/**
 * 업무 프로젝트 자유 태그. `work-projects.json`이 아니라 **별도 파일**(`project-tags.json`)에 산다 —
 * 그 파일의 파서가 exact-keys라 필드를 하나 더하면 구버전 앱이 목록 전체를 거부하기 때문이다
 * (docs/superpowers/specs/registry-contract.md §8). 구버전은 모르는 파일을 그냥 무시한다.
 */
export const MAX_TAG_LENGTH = 32;

export interface ProjectTagsV1 {
  schemaVersion: 1;
  updatedAt: string;
  /**
   * workProjectId → 태그. **빈 배열 행을 지우지 않는다** — 행이 있다는 사실이 "사용자가 한 번은
   * 태그를 손댔다"는 표식이고, ws-root 동기화는 그 표식만 보고 채널 라벨을 다시 심을지 정한다.
   * 사라진 업무 프로젝트의 행은 읽는 쪽이 지나치고 동기화가 정리한다.
   */
  tags: Record<string, string[]>;
}

/** trim → 빈 값 제거 → 32자 절단 → 중복 제거(대소문자 구분, 첫 등장 순서). 절단이 중복 제거보다 먼저다. */
export function normalizeTags(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const tag = value.trim().slice(0, MAX_TAG_LENGTH);
    if (tag.length === 0 || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

export function tagsOf(registry: ProjectTagsV1 | null | undefined, workProjectId: string): string[] {
  return registry?.tags[workProjectId] ?? [];
}

/** 트리·배지가 쓰는 조회 맵. 지금 존재하는 업무 프로젝트의 행만 남는다. */
export function tagsByWorkProject(
  registry: ProjectTagsV1 | null | undefined,
  knownIds: Iterable<string>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (!registry) return result;
  for (const id of knownIds) {
    const tags = registry.tags[id];
    if (tags) result[id] = [...tags];
  }
  return result;
}

/** 자동완성·묶기 후보. 많이 쓰인 태그가 앞, 동률이면 이름순 — 고르는 목록은 예측 가능해야 한다. */
export function knownTags(byWorkProject: Readonly<Record<string, readonly string[]>>): string[] {
  const counts = new Map<string, number>();
  for (const tags of Object.values(byWorkProject)) {
    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ko"))
    .map(([tag]) => tag);
}
