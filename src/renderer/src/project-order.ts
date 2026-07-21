/** Which side of the hovered folder the dragged one would land on. */
export type DropPosition = "before" | "after";

/**
 * The new folder order after a drag, as a list of ids. Kept separate from the sidebar so the
 * index arithmetic — the part that is easy to get subtly wrong — can be tested on its own.
 *
 * A drag that changes nothing (onto itself, or back where it started) returns the same order, so
 * the caller can compare and skip the write.
 */
export function reorderIds(
  ids: readonly string[],
  draggedId: string,
  targetId: string,
  position: DropPosition,
): string[] {
  const next = [...ids];
  if (draggedId === targetId) return next;
  const from = next.indexOf(draggedId);
  if (from === -1 || !next.includes(targetId)) return next;
  next.splice(from, 1);
  // Located after the removal, so the target's index already accounts for the gap left behind.
  const target = next.indexOf(targetId);
  next.splice(position === "after" ? target + 1 : target, 0, draggedId);
  return next;
}
