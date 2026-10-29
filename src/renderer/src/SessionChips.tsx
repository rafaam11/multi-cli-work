import type { StatusChip } from "@shared/terminal-types";

/**
 * Short display metadata from the session's host. Each chip is keyed by its content, so a
 * changed chip mounts fresh and plays its short pulse — a glance across the grid catches what moved.
 */
export function SessionChips({ chips }: { chips: readonly StatusChip[] }) {
  if (chips.length === 0) return null;
  return (
    <span className="pane-chips">
      {chips.map((chip) => (
        <span
          key={`${chip.key}\u0000${chip.text}\u0000${chip.color}`}
          data-testid="pane-chip"
          className={`pane-chip pane-chip-${chip.color}`}
          title={`${chip.key}: ${chip.text}`}
        >
          {chip.text}
        </span>
      ))}
    </span>
  );
}
