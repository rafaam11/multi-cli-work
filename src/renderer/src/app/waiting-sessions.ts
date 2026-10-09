import type { SessionAttention } from "@shared/api-types";

interface WaitingCandidate {
  id: string;
  status: string;
  updatedAt: string;
}

const isWaiting = (status: string) => status === "awaiting-input" || status === "awaiting-approval";

/**
 * When each waiting session started waiting. A session keeps its first stamp for as long as it waits
 * — its `updatedAt` also moves for a title or a rename — and drops out the moment it stops.
 */
export function trackWaitingSince(
  previous: ReadonlyMap<string, number>,
  sessions: readonly WaitingCandidate[],
  now: number,
): Map<string, number> {
  const next = new Map<string, number>();
  for (const session of sessions) {
    if (!isWaiting(session.status)) continue;
    const stamped = previous.get(session.id);
    const updated = Date.parse(session.updatedAt);
    next.set(session.id, stamped ?? (Number.isFinite(updated) ? updated : now));
  }
  return next;
}

/**
 * The session the "다음 대기 세션" key goes to: an approval before an input wait, one the user has not
 * looked at yet before one already seen, then whoever has waited longest. Pressing again from there
 * moves down the same list and wraps around.
 */
export function nextWaitingSession(
  sessions: readonly WaitingCandidate[],
  waitingSince: ReadonlyMap<string, number>,
  unread: Readonly<Record<string, SessionAttention>>,
  currentId: string | null,
): string | null {
  const ordered = sessions
    .filter((session) => isWaiting(session.status))
    .map((session, order) => ({
      id: session.id,
      rank: [
        session.status === "awaiting-approval" ? 0 : 1,
        session.id in unread ? 0 : 1,
        waitingSince.get(session.id) ?? Number.POSITIVE_INFINITY,
        order,
      ],
    }))
    .sort((a, b) => {
      for (let index = 0; index < a.rank.length; index += 1) {
        if (a.rank[index] !== b.rank[index]) return a.rank[index] - b.rank[index];
      }
      return 0;
    })
    .map((entry) => entry.id);
  if (ordered.length === 0) return null;
  const at = currentId === null ? -1 : ordered.indexOf(currentId);
  return ordered[(at + 1) % ordered.length];
}
