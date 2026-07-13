/** One row the palette can jump to. `key` is what selection dispatches on (e.g. "session:<id>"). */
export interface QuickOpenItem {
  key: string;
  kind: "session" | "project" | "command";
  label: string;
  /** Dimmed context: the folder a session belongs to, or a folder's path. */
  detail: string | null;
}

/**
 * Subsequence match. Query characters must appear in order; consecutive runs and word starts score
 * higher, so "clau" prefers "Claude Code" over a label that merely contains those letters scattered.
 * Spaces in the query are ignored. Returns null when the query does not match at all.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const lowerTarget = target.toLowerCase();
  let score = 0;
  let searchFrom = 0;
  let previousIndex = -2;
  for (const char of query.toLowerCase()) {
    if (char === " ") continue;
    const index = lowerTarget.indexOf(char, searchFrom);
    if (index === -1) return null;
    score += 1;
    if (index === previousIndex + 1) score += 2;
    if (index === 0 || /[\s\-_./\\]/.test(lowerTarget[index - 1] ?? "")) score += 2;
    previousIndex = index;
    searchFrom = index + 1;
  }
  return score;
}

/**
 * An empty query keeps the caller's order (most recent first is the caller's job); ties keep it
 * too, so equally-scored sessions stay ahead of equally-scored commands.
 */
export function rankQuickOpen<T extends QuickOpenItem>(items: readonly T[], query: string, limit = 10): T[] {
  const trimmed = query.trim();
  if (trimmed === "") return items.slice(0, limit);
  const scored: Array<{ item: T; score: number; order: number }> = [];
  items.forEach((item, order) => {
    const haystack = item.detail ? `${item.label} ${item.detail}` : item.label;
    const score = fuzzyScore(trimmed, haystack);
    if (score !== null) scored.push({ item, score, order });
  });
  return scored
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, limit)
    .map((entry) => entry.item);
}
